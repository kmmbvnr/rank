// Build first. Compare reader bounds checks independently of Euler/set storage.
// node benchmarks/scalar-array-reader.mjs [interpreter/out/array-storage.js]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const module = resolve(process.argv[2] ?? 'packages/interpreter/out/array-storage.js');
const { ownedArray, prepareScalarArrayReader } = await import(pathToFileURL(module).href);
const size = 2200, repeats = 1000;
const indices = Array.from({ length: size }, (_, index) => BigInt(index));
const array = ownedArray(indices, [size], true);
const read = prepareScalarArrayReader(array, () => { throw new Error('unexpected fallback'); });
const start = performance.now();
let checksum = 0n;
for (let repeat = 0; repeat < repeats; repeat++) {
    for (const index of indices) checksum += read(index);
}
const elapsedMs = performance.now() - start;
assert.equal(checksum, BigInt(repeats) * BigInt(size * (size - 1) / 2));
console.log(JSON.stringify({ node: process.version, reads: size * repeats, elapsedMs, checksum: String(checksum) }));
