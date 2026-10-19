// Build first. Fresh-process samples; diagnostic executions are separate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const original = readFileSync(new URL('../demos/euler/154_pascalpyramid.ra', import.meta.url), 'utf8');
const cases = [
    { name: 'small', source: original.replace('= 200000', '= 5000').replace('= 12', '= 3'), answer: 12497574n },
    { name: 'default', source: original, answer: 479742450n },
];
if (option('worker')) {
    const entry = cases.find(entry => entry.name === option('worker')); assert.ok(entry);
    const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
        ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    const instrumented = process.argv.includes('--diagnostic');
    try {
        const start = performance.now();
        if (instrumented) diagnostics.run(() => runtime.execute(entry.source));
        else runtime.execute(entry.source);
        const executeMs = performance.now() - start;
        assert.equal(runtime.variables.get('Answer'), entry.answer);
        const bufferCells = ['Is', 'F2', 'F5'].map(name => [name, runtime.variables.get(name).shape[0]]);
        console.log(JSON.stringify({ case: entry.name, executeMs, answer: String(entry.answer), bufferCells,
            sourceSha256: createHash('sha256').update(entry.source).digest('hex'),
            ...(instrumented ? { numberLoops: diagnostics.numberLoops, overflows: diagnostics.numberLoopOverflows,
                compiledLoops: diagnostics.compiledLoops } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), selected = option('cases')?.split(',');
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timings: 'serial fresh processes; execution includes parsing/preparation, cold includes imports/disposal; diagnostics separate',
        baseline: option('baseline') ?? null }));
    for (const entry of cases.filter(entry => !selected || selected.includes(entry.name))) {
        const variants = [['candidate', undefined], ...(option('baseline') && (entry.name === 'small' || process.argv.includes('--baseline-default'))
            ? [['baseline', option('baseline')]] : [])];
        for (const [variant, runtime] of variants) {
            const samples = [];
            const run = diagnostic => {
                const start = performance.now();
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`,
                    ...(runtime ? [`--runtime=${runtime}`] : []), ...(diagnostic ? ['--diagnostic'] : [])],
                    { encoding: 'utf8', timeout: entry.name === 'default' && variant === 'baseline' ? 600000 : 120000 });
                assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
                return { ...JSON.parse(child.stdout), coldMs: performance.now() - start };
            };
            for (let trial = 0; trial < trials; trial++) {
                const sample = { variant, trial, ...run(false) }; samples.push(sample); console.log(JSON.stringify(sample));
            }
            const median = field => samples.map(sample => sample[field]).sort((a, b) => a - b)[Math.floor(trials / 2)];
            console.log(JSON.stringify({ case: entry.name, variant, medianExecuteMs: median('executeMs'), medianColdMs: median('coldMs') }));
            const diagnostic = run(true); console.log(JSON.stringify({ variant, diagnostic: true, ...diagnostic }));
            if (variant === 'candidate') {
                assert.equal(diagnostic.numberLoops, 1); assert.equal(diagnostic.overflows, 0);
                if (entry.name === 'default') assert.ok(samples.every(sample => sample.executeMs < 30000), 'issue #316 default <30 s');
            }
        }
    }
}
