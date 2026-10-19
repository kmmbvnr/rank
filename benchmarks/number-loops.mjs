// Build first. Each sample runs in a fresh process. Optional --baseline=/path/to/out/index.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const cases = [
    { name: 'repro', source: 'S = 0\nfor I in 1 to 100000000\n S += I mod 7 * 3 + 1\nend', result: 'S', expected: 999999991n },
    { name: '150-original', source: load('./fixtures/150-subtriangle-original.ra'), result: 'Answer', expected: -271248680n },
    { name: '150-current', source: load('../demos/euler/150_subtriangle.ra'), result: 'Answer', expected: -271248680n },
];
if (option('worker')) {
    const entry = cases.find(value => value.name === option('worker'));
    assert.ok(entry);
    const { Interpreter, RuntimeDiagnostics } = await import(option('runtime')
        ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    const instrumented = process.argv.includes('--diagnostic'), start = performance.now();
    try {
        if (instrumented) diagnostics.run(() => runtime.execute(entry.source));
        else runtime.execute(entry.source);
        const executeMs = performance.now() - start;
        assert.equal(runtime.variables.get(entry.result), entry.expected);
        if (instrumented) assert.ok(diagnostics.numberLoops > 0, 'Number backend actually executed');
        console.log(JSON.stringify({ case: entry.name, executeMs, result: String(entry.expected), ...(instrumented ? { diagnostics } : {}) }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), selected = option('cases')?.split(',');
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timings: 'fresh processes; execute includes parsing; cold includes imports and disposal; diagnostics separate' }));
    for (const entry of cases.filter(value => !selected || selected.includes(value.name))) {
        for (const [variant, runtime] of [['candidate', undefined], ...(option('baseline') ? [['baseline', option('baseline')]] : [])]) {
            const samples = [];
            for (let trial = 0; trial < trials; trial++) {
                const start = performance.now();
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`,
                    ...(runtime ? [`--runtime=${runtime}`] : [])], { encoding: 'utf8', timeout: 120000 });
                assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
                const sample = { ...JSON.parse(child.stdout), variant, trial, coldMs: performance.now() - start };
                samples.push(sample); console.log(JSON.stringify(sample));
            }
            const median = field => samples.map(sample => sample[field]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
            const summary = { case: entry.name, variant, medianExecuteMs: median('executeMs'), medianColdMs: median('coldMs') };
            console.log(JSON.stringify(summary));
            if (variant === 'candidate') {
                assert.ok(summary.medianExecuteMs < (entry.name === 'repro' ? 1000 : 5000), 'issue #311 target');
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`, '--diagnostic'], { encoding: 'utf8', timeout: 120000 });
                assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
                console.log(JSON.stringify({ variant, diagnostic: true, ...JSON.parse(child.stdout) }));
            }
        }
    }
}
