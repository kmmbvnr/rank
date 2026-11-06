import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { Interpreter, isRankArray } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const { typedArray, readArrayItem } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const operation = process.argv[2] ?? 'product';
const size = 1048576, modulus = 1000000007n;
const left = Int32Array.from({ length: size }, (_, i) => 1000000006 - i % 10000);
const right = Int32Array.from({ length: size }, (_, i) => 1000000005 - i % 20000);
const runtime = new Interpreter(() => {}, { numberLoopCompilation: false, scalarFunctionCompilation: false });
try {
    runtime.variables.set('A', typedArray(left)); runtime.variables.set('B', typedArray(right));
    runtime.execute('0'); // Initialize the parser outside the kernel timing.
    const cpu = process.cpuUsage(), start = performance.now();
    const result = runtime.execute(operation === 'product' ? 'Saved = A * B mod 1000000007\nSaved' : 'Saved = A + B\nSaved');
    const ms = performance.now() - start, used = process.cpuUsage(cpu), maxRssMiB = process.resourceUsage().maxRSS / 1024;
    assert(isRankArray(result));
    for (let i = 0; i < size; i++) assert.equal(readArrayItem(result, i), operation === 'product'
        ? BigInt(left[i]) * BigInt(right[i]) % modulus : BigInt(left[i]) + BigInt(right[i]));
    console.log(JSON.stringify({ operation, size, parserWarmed: true, ms, cpuMs: (used.user + used.system) / 1000, maxRssMiB,
        node: process.version, arch: process.arch }));
} finally { runtime.dispose(); }
