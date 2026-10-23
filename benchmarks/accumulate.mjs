import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { typedArray, readArrayItem } from '../packages/interpreter/out/array-storage.js';

const size = Number(process.argv[2] ?? 10000000);
assert(Number.isSafeInteger(size) && size > 0);
const buckets = 512, samples = 5;
const indices = new BigInt64Array(size), weights = new BigInt64Array(size), factors = new BigInt64Array(size);
const sums = Array(buckets).fill(0n), counts = Array(buckets).fill(0n), products = Array(buckets).fill(1n);
let seed = 123456789;
for (let i = 0; i < size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const index = seed >>> 23, weight = BigInt(1 + (seed % 7)), factor = seed & 1 ? -1n : 1n;
    indices[i] = BigInt(index); weights[i] = weight; factors[i] = factor;
    counts[index]++; sums[index] += weight; products[index] *= factor;
}
// Wrap and prepare inputs before timing. Products use +/-1 to bound result size.
const input = typedArray(indices), weighted = typedArray(weights), multiplied = typedArray(factors);
const rows = [];
for (const operator of ['+=', '-=', '*=']) for (const weightedCase of [false, true]) {
    const runtime = new Interpreter();
    try {
        const fill = operator === '*=' ? 1n : 0n;
        const operand = weightedCase ? 'Weights I' : operator === '*=' ? '-1' : '1';
        const bulkOperand = weightedCase ? 'Weights' : operand;
        runtime.execute(`use sequences
fun Values Weights scalarcase
 A = array shape ${buckets} fill ${fill}
 for I in 0 till Values len
  A (Values I) ${operator} ${operand}
 end
 return A
end
fun Values Weights bulkcase
 A = array shape ${buckets} fill ${fill}
 A Values ${operator} ${bulkOperand} .accumulate
 return A
end`);
        const args = [input, operator === '*=' ? multiplied : weighted];
        const expected = counts.map((count, index) => operator === '*='
            ? weightedCase ? products[index] : count % 2n ? -1n : 1n
            : (operator === '-=' ? -1n : 1n) * (weightedCase ? sums[index] : count));
        const functions = ['scalarcase', 'bulkcase'].map(name => runtime.variables.get(name));
        const times = [[], []];
        const warm = [typedArray(indices.slice(0, 10000)), typedArray((operator === '*=' ? factors : weights).slice(0, 10000))];
        for (const fn of functions) for (let i = 0; i < 3; i++) fn.call(warm);
        for (let sample = 0; sample < samples; sample++) {
            for (const index of sample % 2 ? [1, 0] : [0, 1]) {
                const start = performance.now();
                const result = functions[index].call(args);
                times[index].push(performance.now() - start);
                for (let bucket = 0; bucket < buckets; bucket++) assert.equal(readArrayItem(result, bucket), expected[bucket]);
            }
        }
        const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
        const scalarMs = median(times[0]), accumulateMs = median(times[1]);
        rows.push({ operator, weighted: weightedCase, scalarMs, accumulateMs, speedup: scalarMs / accumulateMs, samplesMs: times });
        console.error(`${operator} weighted=${weightedCase}: ${scalarMs.toFixed(1)} -> ${accumulateMs.toFixed(1)} ms (${(scalarMs / accumulateMs).toFixed(2)}x)`);
    } finally { runtime.dispose(); }
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, size, buckets, samples,
        timing: 'parse-once, prepared inputs, alternating order, all bins verified outside timing', rows }, null, 2));
