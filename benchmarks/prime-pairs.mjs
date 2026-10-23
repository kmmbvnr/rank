// Build both checkouts first. Run without other benchmark or test jobs:
// node benchmarks/prime-pairs.mjs --baseline=/path/to/baseline --samples=5
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(import.meta.url);
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
    const match = /^--(baseline|samples|worker|checkout)=(.+)$/.exec(argument);
    assert(match, `Unknown argument: ${argument}`);
    return [match[1], match[2]];
}));
const file = 'demos/euler/347_twoprimes.ra';
const expected = '11109800204052';
if (options.worker) {
    const checkout = resolve(options.checkout);
    const { Interpreter } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const source = readFileSync(resolve(checkout, file), 'utf8');
    const start = performance.now();
    const runtime = new Interpreter(() => {}, options.worker === 'exact' ? { numberLoopCompilation: false } : {});
    try {
        runtime.execute(source);
        assert.equal(String(runtime.variables.get('Answer')), expected);
        console.log(JSON.stringify({ milliseconds: performance.now() - start, answer: expected,
            sourceHash: createHash('sha256').update(source).digest('hex') }));
    } finally { runtime.dispose(); }
} else {
    assert(options.baseline, 'Provide --baseline=/path/to/built/checkout');
    const samples = Number(options.samples ?? 5);
    assert(Number.isSafeInteger(samples) && samples >= 3);
    const cases = [
        { name: 'baseline', checkout: resolve(options.baseline), mode: 'default' },
        { name: 'exact', checkout: root, mode: 'exact' },
        { name: 'candidate', checkout: root, mode: 'default' },
    ];
    const milliseconds = Object.fromEntries(cases.map(entry => [entry.name, []]));
    let sourceHash;
    for (let sample = 0; sample < samples; sample++) {
        for (const entry of sample % 2 ? [...cases].reverse() : cases) {
            const child = spawnSync(process.execPath, [script, `--worker=${entry.mode}`, `--checkout=${entry.checkout}`],
                { encoding: 'utf8', timeout: 60000 });
            assert.equal(child.status, 0, child.error?.message ?? child.stderr);
            const result = JSON.parse(child.stdout);
            sourceHash ??= result.sourceHash;
            assert.equal(result.sourceHash, sourceHash, 'Benchmark sources must be identical');
            assert.equal(result.answer, expected);
            milliseconds[entry.name].push(result.milliseconds);
        }
    }
    const medians = Object.fromEntries(Object.entries(milliseconds).map(([name, values]) =>
        [name, [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, file, expected, sourceHash, samples,
        revisions: Object.fromEntries(cases.map(entry => [entry.name,
            execFileSync('git', ['rev-parse', 'HEAD'], { cwd: entry.checkout, encoding: 'utf8' }).trim()])),
        milliseconds, medians, speedup: medians.baseline / medians.candidate,
        numericSpeedup: medians.exact / medians.candidate }, null, 2));
}
