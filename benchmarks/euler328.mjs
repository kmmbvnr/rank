// Build first. Fresh-process timing separates interpreter and algorithm changes.
// --baseline=/path/to/packages/interpreter/out/index.js compares the old source.
// --worker=original-full --budget-ms=30000 supports a bounded CPU profile.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const cases = [
    { name: 'original-small', n: 2000, original: true, expected: 14210783n },
    { name: 'current-small', n: 2000, expected: 14210783n },
    { name: 'current-full', n: 200000, expected: 260511850222n },
    { name: 'original-full', n: 200000, original: true, expected: 260511850222n },
];
if (option('worker')) {
    const entry = cases.find(entry => entry.name === option('worker'));
    assert.ok(entry, 'unknown benchmark case');
    const runtimeUrl = option('runtime') ? pathToFileURL(option('runtime'))
        : new URL('../packages/interpreter/out/index.js', import.meta.url);
    const { Interpreter, RuntimeDiagnostics } = await import(runtimeUrl.href);
    const source = readFileSync(new URL(entry.original ? './fixtures/euler328-original.ra'
        : '../demos/euler/328_lowestcost.ra', import.meta.url), 'utf8')
        .replace('Answer = 200000 costs', `Answer = ${entry.n} costs`);
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    const instrumented = process.argv.includes('--diagnostic');
    const budget = option('budget-ms') === undefined ? undefined : Number(option('budget-ms'));
    assert.ok(budget === undefined || Number.isFinite(budget) && budget > 0);
    const start = performance.now();
    let interrupted = false;
    try {
        const run = () => instrumented ? diagnostics.run(() => runtime.execute(source)) : runtime.execute(source);
        if (budget === undefined) run();
        else {
            const { withInterrupt, InterruptedError } = await import(new URL('./interrupt.js', runtimeUrl));
            try {
                withInterrupt({ length: 1, load: () => 0, store: () => {}, wait: () => {},
                    exchange: () => Number(performance.now() - start >= budget) }, run);
            } catch (error) {
                if (!(error instanceof InterruptedError)) throw error;
                interrupted = true;
            }
        }
        const executeMs = performance.now() - start;
        if (!interrupted) assert.equal(runtime.variables.get('Answer'), entry.expected);
        if (instrumented && !entry.original) assert.ok(diagnostics.numberLoops > 0, 'Number backend executed');
        console.log(JSON.stringify({ case: entry.name, n: entry.n, executeMs, interrupted,
            result: interrupted ? undefined : String(entry.expected), ...(instrumented ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3);
    assert.ok(Number.isSafeInteger(trials) && trials > 0);
    const selected = (option('cases') ?? 'original-small,current-small,current-full').split(',');
    assert.ok(selected.every(name => cases.some(entry => entry.name === name)), 'unknown benchmark case');
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timings: 'fresh processes; execute includes parsing; cold includes imports and disposal; diagnostics separate' }));
    for (const entry of cases.filter(entry => selected.includes(entry.name))) {
        const variants = [['candidate', undefined], ...(option('baseline') && entry.original ? [['baseline', option('baseline')]] : [])];
        for (const [variant, runtime] of variants) {
            const samples = [];
            const run = diagnostic => {
                const start = performance.now();
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`,
                    ...(runtime ? [`--runtime=${runtime}`] : []), ...(diagnostic ? ['--diagnostic'] : [])],
                { encoding: 'utf8', timeout: 120000 });
                assert.ifError(child.error);
                assert.equal(child.status, 0, child.stderr);
                return { ...JSON.parse(child.stdout), variant, coldMs: performance.now() - start };
            };
            for (let trial = 0; trial < trials; trial++) {
                const sample = { ...run(false), trial };
                samples.push(sample);
                console.log(JSON.stringify(sample));
            }
            const median = field => samples.map(sample => sample[field]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
            console.log(JSON.stringify({ case: entry.name, variant, medianExecuteMs: median('executeMs'), medianColdMs: median('coldMs') }));
            if (variant === 'candidate') console.log(JSON.stringify({ diagnostic: true, ...run(true) }));
        }
    }
}
