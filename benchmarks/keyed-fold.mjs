import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';
import { typedArray, readArrayItem } from '../packages/interpreter/out/array-storage.js';

const count = Number(process.argv[2] ?? 1000000);
assert(Number.isSafeInteger(count) && count > 0);
const bins = 512, samples = 5;
const values = Int32Array.from({ length: count }, (_, i) => i % 11 - 5);
const keys = Int32Array.from(values, (_, i) => (Math.imul(i, 7919) >>> 0) % bins);
const expected = Array(bins).fill(0n);
for (let i = 0; i < count; i++) expected[keys[i]] += BigInt(values[i]);
const runtimes = [false, true].map(compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    runtime.variables.set('V', typedArray(values));
    runtime.variables.set('K', typedArray(keys));
    return runtime;
});
const programs = runtimes.map(runtime => runtime.parse(`V reduce + by K size ${bins}`));
const times = [[], []];
const run = index => {
    const start = performance.now();
    const result = runtimes[index].executeProgram(programs[index]);
    const elapsed = performance.now() - start;
    assert(isRankArray(result));
    for (let at = 0; at < bins; at++) assert.equal(readArrayItem(result, at), expected[at]);
    return elapsed;
};
try {
    for (let i = 0; i < 2; i++) { run(0); run(1); }
    for (let sample = 0; sample < samples; sample++) {
        for (const index of sample % 2 ? [1, 0] : [0, 1]) times[index].push(run(index));
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(JSON.stringify({ cpu: cpus()[0]?.model, node: process.version, count, bins,
        timing: 'prepared arrays and parsed programs; alternating order; all bins independently checked outside timing',
        genericMs: median(times[0]), optimizedMs: median(times[1]), samplesMs: times }, null, 2));
} finally { for (const runtime of runtimes) runtime.dispose(); }
