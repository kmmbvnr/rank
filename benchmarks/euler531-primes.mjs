import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const load = file => import(pathToFileURL(`${root}/packages/interpreter/out/${file}.js`));
const { densePrimePlan } = await load('dense-prime-sieve');
const { materializeSequence } = await load('sequence');
const { readArrayItem } = await load('array-storage');
const mode = process.argv[2] ?? 'full';
assert.ok(['full', 'small', 'narrow'].includes(mode));
let plan = densePrimePlan(10000000n);
if (mode === 'small') plan = plan.withUpperBound(17n, true);
if (mode === 'narrow') plan = plan.withLowerBound(9999900n, true);
const expected = mode === 'full' ? undefined : [...plan.iterate()];
const start = performance.now();
const result = materializeSequence({ kind: 'sequence', plan });
const firstMs = performance.now() - start;
let ms = firstMs;
if (mode !== 'full') {
    const samples = [];
    for (let repeat = 0; repeat < 150; repeat++) {
        const start = performance.now();
        materializeSequence({ kind: 'sequence', plan });
        if (repeat >= 50) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    ms = (samples[49] + samples[50]) / 2;
}
if (expected) assert.deepEqual(Array.from({ length: result.shape[0] }, (_, i) => readArrayItem(result, i)), expected);
else {
    assert.equal(result.shape[0], 664579);
    assert.equal(readArrayItem(result, 0), 2n);
    assert.equal(readArrayItem(result, 664578), 9999991n);
}
console.log(JSON.stringify({ mode, ms, firstMs, maxRssMiB: process.resourceUsage().maxRSS / 1024,
    node: process.version, arch: process.arch }));
