// Affected broadcast kernel plus an unchanged equal-shape control.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..');
const load = path => import(pathToFileURL(resolve(root, 'packages/interpreter/out', path)));
const { mapStoredIntegers } = await load('jit/integer-array-kernel.js');
const { typedArray, readArrayItem } = await load('array-storage.js');
const mode = process.argv[2] ?? 'broadcast';
assert.ok(['broadcast', 'wide', 'lane', 'control'].includes(mode));
const leftShape = ['broadcast', 'wide'].includes(mode) ? [32, 99, 1] : mode === 'lane' ? [128, 32, 1] : [131072];
const rightShape = ['broadcast', 'wide'].includes(mode) ? [32, 1, 99] : mode === 'lane' ? [1, 32, 1] : [131072];
const size = shape => shape.reduce((a, b) => a * b, 1);
const left = typedArray(new Int32Array(size(leftShape)).fill(3), leftShape);
const right = typedArray(new Int32Array(size(rightShape)).fill(mode === 'wide' ? 2147483647 : -7), rightShape);
const rounds = mode === 'lane' ? 1000 : 20;
const start = performance.now();
let result;
for (let i = 0; i < rounds; i++) result = mapStoredIntegers(left, right, '*');
const ms = performance.now() - start;
assert.ok(result);
const expected = mode === 'wide' ? 6442450941n : -21n;
assert.equal(readArrayItem(result, 0), expected);
assert.equal(readArrayItem(result, size(result.shape) - 1), expected);
console.log(JSON.stringify({ mode, rounds, ms, maxRssMiB: process.resourceUsage().maxRSS / 1024,
    node: process.version, arch: process.arch }));
