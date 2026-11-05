// One mode per fresh process. RANK_ROOT selects a built checkout.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const load = file => import(pathToFileURL(`${root}/packages/interpreter/out/${file}.js`));
const { filledArray, writeArrayCell } = await load('array-storage');
const { packedTruePositions } = await load('packed-booleans');
const mode = process.argv[2] ?? 'dense';
const cases = { small: [65, 1], empty: [1000000, 0], sparse: [1000000, 10000], dense: [1000000, 1] };
assert.ok(mode in cases);
const [size, stride] = cases[mode];
const mask = filledArray(stride === 1, [size]);
if (stride > 1) for (let i = 0; i < size; i += stride) writeArrayCell(mask, i, true);
const result = packedTruePositions(mask);
assert.equal(result.length, stride ? Math.ceil(size / stride) : 0);
for (let i = 0; i < result.length; i++) assert.equal(result[i], i * stride);
const batch = mode === 'small' ? 1000 : mode === 'dense' ? 1 : 10;
const samples = [];
for (let repeat = 0; repeat < 125; repeat++) {
    const start = performance.now();
    for (let i = 0; i < batch; i++) assert.equal(packedTruePositions(mask).length, result.length);
    if (repeat >= 25) samples.push((performance.now() - start) / batch);
}
const sorted = samples.sort((a, b) => a - b);
console.log(JSON.stringify({ mode, ms: (sorted[49] + sorted[50]) / 2,
    maxRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch }));
