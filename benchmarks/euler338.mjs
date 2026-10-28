// Build first. Compare interpreter changes with --baseline=/path/to/interpreter/out/index.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const cases = [
    { name: 'original-full', n: 1000000000000n, expected: 999999999600010915614292n, original: true },
    { name: 'original', n: 10000000000n, expected: 99999997195292891339n, original: true },
    { name: 'algorithm', n: 10000000000n, expected: 99999997195292891339n },
    { name: 'full', n: 1000000000000n, expected: 999999999600010915614292n },
];
if (option('worker')) {
    const entry = cases.find(entry => entry.name === option('worker'));
    assert.ok(entry, 'unknown benchmark case');
    const runtime = option('runtime') ? pathToFileURL(option('runtime')) : new URL('../packages/interpreter/out/index.js', import.meta.url);
    const { Interpreter } = await import(runtime.href);
    const source = readFileSync(new URL(entry.original ? './fixtures/euler338-original.ra' : '../demos/euler/338_gridpaper.ra', import.meta.url), 'utf8')
        .replace('use io', '').replace('use cli', '')
        .replace('arg Limit integer = 1000000000000', `Limit = ${entry.n}`)
        .replace('Limit grid print', 'Answer = Limit grid');
    const interpreter = new Interpreter(() => {}), start = performance.now();
    try {
        interpreter.execute(source);
        const executeMs = performance.now() - start;
        assert.equal(interpreter.variables.get('Answer'), entry.expected);
        console.log(JSON.stringify({ case: entry.name, executeMs, result: String(entry.expected) }));
    } finally { interpreter.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3);
    const timeout = Number(option('timeout-ms') ?? 30000);
    assert.ok(Number.isSafeInteger(timeout) && timeout > 0);
    assert.ok(Number.isSafeInteger(trials) && trials > 0);
    const selected = (option('cases') ?? 'original,algorithm,full').split(',');
    assert.ok(selected.every(name => cases.some(entry => entry.name === name)), 'unknown benchmark case');
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, timings: 'fresh processes; execute includes parsing; correctness checked on every sample' }));
    for (const entry of cases.filter(entry => selected.includes(entry.name))) {
        const variants = [...(option('baseline') ? [['baseline', option('baseline')]] : []), ['candidate', undefined]];
        const samples = new Map(variants.map(([variant]) => [variant, []]));
        for (let trial = 0; trial < trials; trial++) {
            for (const [variant, runtime] of variants) {
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`,
                    ...(runtime ? [`--runtime=${runtime}`] : [])], { encoding: 'utf8', timeout });
                assert.ifError(child.error);
                assert.equal(child.status, 0, child.stderr);
                const sample = { ...JSON.parse(child.stdout), variant, trial };
                samples.get(variant).push(sample.executeMs);
                console.log(JSON.stringify(sample));
            }
        }
        for (const [variant, times] of samples) {
            times.sort((a, b) => a - b);
            console.log(JSON.stringify({ case: entry.name, variant, medianExecuteMs: times[Math.floor(times.length / 2)] }));
        }
    }
}
