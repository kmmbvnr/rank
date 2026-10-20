// Build first: npx tsc -b tsconfig.build.json
// Run: node --expose-gc benchmarks/owned-array-allocation.mjs [count] [samples]
import { performance } from 'node:perf_hooks';
import { ownedScalarArray, denseScalarItems } from '../packages/interpreter/out/array-storage.js';

if (!globalThis.gc) throw new Error('Run with --expose-gc');
const count = Number(process.argv[2] ?? 50000), samples = Number(process.argv[3] ?? 5);
if (![count, samples].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Expected positive count and samples');
let retained = [];
function measure(count) {
    retained = [];
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let index = 0; index < count; index++) retained.push(ownedScalarArray([1n, 2n, 3n, 4n], 'integer'));
    const milliseconds = performance.now() - start;
    globalThis.gc();
    const heapBytes = process.memoryUsage().heapUsed - before;
    let checksum = 0n;
    for (const value of retained) checksum += denseScalarItems(value)[0];
    if (checksum !== BigInt(count)) throw new Error('Incorrect allocation result');
    return { milliseconds, heapBytes, bytesPerArray: heapBytes / count };
}
measure(Math.min(count, 5000));
const results = Array.from({ length: samples }, () => measure(count));
const median = key => results.map(row => row[key]).sort((a, b) => a - b)[Math.floor(samples / 2)];
console.log(JSON.stringify({ count, samples, medianMilliseconds: median('milliseconds'),
    medianHeapBytes: median('heapBytes'), medianBytesPerArray: median('bytesPerArray'), results }, null, 2));
