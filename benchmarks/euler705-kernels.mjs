// Fresh process per sample; RANK_ROOT selects a built checkout.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..');
const load = path => import(pathToFileURL(resolve(root, 'packages/interpreter/out', path)));
const { typedArray, readArrayItem } = await load('array-storage.js');
const { permutedArray } = await load('array-permutation.js');
const { matmulValues } = await load('modules/linalg.js');
const mode = process.argv[2] ?? 'transpose';
const kind = process.argv[3] ?? 'int32';
const size = Number(process.argv[4] ?? 131072);
assert.ok(['transpose', 'axes'].includes(mode));
assert.ok(['int32', 'real', 'unsafe'].includes(kind));
const a = new (kind === 'real' ? Float64Array : Int32Array)(size * 9);
const b = new (kind === 'real' ? Float64Array : Int32Array)(size * 9);
for (let row = 0; row < 9; row++) for (let k = 0; k < size; k++) {
    a[row * size + k] = kind === 'unsafe' ? 2147483647 : (row + k) % 1024;
    b[row * size + k] = k % 9 === row ? kind === 'unsafe' ? 100000000 : 1 : 0;
}
const left = typedArray(a, [9, size]), right = typedArray(b, [9, size]);
const start = performance.now();
const result = mode === 'transpose'
    ? matmulValues(left, permutedArray(right, [1, 0]))
    : matmulValues(left, right, [1, 1]);
const ms = performance.now() - start;
for (let row = 0; row < 9; row++) for (let column = 0; column < 9; column++) {
    let expected = 0n;
    for (let k = column; k < size; k += 9) expected += BigInt(a[row * size + k]) * BigInt(b[column * size + k]);
    assert.equal(readArrayItem(result, row * 9 + column), kind === 'real' ? Number(expected) : expected);
}
console.log(JSON.stringify({ mode, kind, size, ms,
    maxRssMiB: process.resourceUsage().maxRSS / 1024,
    node: process.version, arch: process.arch }));
