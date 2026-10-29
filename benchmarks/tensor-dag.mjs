import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Run in fresh processes against separately built checkouts. Parsing/loading
// are outside the warm timings; every measured result has an exact oracle.
const root = resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname);
const { Interpreter } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const { ownedArray, typedArray } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const { demandValue } = await import(pathToFileURL(`${root}/packages/interpreter/out/plan.js`));
const size = 10000;
const cases = [];
for (const depth of [0, 4, 6, 7, 8]) {
    const stages = Array.from({ length: depth }, (_, i) => ` S${i + 1}' = S${i} + S${i}`).join('\n');
    cases.push({ name: `dag-${depth}`, source: `fun A probe\n S0' = A * 2\n${stages}\n R = S${depth} sum\n return R\nend`,
        args: () => [ownedArray(Array(size).fill(1n))], expected: BigInt(size) * 2n ** BigInt(depth + 1), repeats: 1 });
}
for (const length of [16, 10000]) for (const type of ['integer', 'real']) for (const operation of ['sum', 'reduce +', 'reduce -', 'reduce *']) {
    const real = type === 'real';
    const a = real ? 1 : 1n, b = real ? 2 : 2n;
    const array = value => real ? typedArray(new Float64Array(length).fill(value), [length]) : ownedArray(Array(length).fill(value));
    const answer = operation === 'reduce *' ? 1 : operation === 'reduce -' ? 2 - length : length;
    // Every cell is 1. The product stays bounded at every benchmark size.
    cases.push({ name: `${operation}-${type}-${length}`, source: `fun A probe B\n R = ((A * 2) + (B - 3)) ${operation}\n return R\nend`,
        args: () => [array(a), array(b)], expected: real ? answer : BigInt(answer), repeats: length === 16 ? 50 : 3 });
}
for (const width of [4, 64]) {
    cases.push({ name: `outer-rows-${width}`, source: `fun A probe\n X' = A * 2\n M' = X X outer +\n Rows' = M sum rank 1\n R = Rows sum\n return R\nend`,
        args: () => [ownedArray(Array(width).fill(1n))], expected: 4n * BigInt(width) ** 2n, repeats: 3 });
}
const results = [];
for (const item of cases) {
    const runtime = new Interpreter();
    runtime.execute(item.source);
    const fn = runtime.variables.get('probe');
    const args = item.args();
    const times = [];
    for (let sample = 0; sample < 7; sample++) {
        const start = performance.now();
        for (let repeat = 0; repeat < item.repeats; repeat++) assert.equal(demandValue(fn.call(args)), item.expected);
        if (sample >= 2) times.push((performance.now() - start) / item.repeats);
    }
    times.sort((a, b) => a - b);
    results.push({ name: item.name, ms: times[2], expected: String(item.expected) });
    runtime.dispose();
}
console.log(JSON.stringify({ node: process.version, root, results }));
