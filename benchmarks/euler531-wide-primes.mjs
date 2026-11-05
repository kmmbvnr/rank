// Manual boundary check: builds a 128 MiB sieve across the signed Int32 limit.
import assert from 'node:assert/strict';
import { densePrimePlan } from '../packages/interpreter/out/dense-prime-sieve.js';
import { materializeSequence } from '../packages/interpreter/out/sequence.js';
import { readArrayItem } from '../packages/interpreter/out/array-storage.js';
import { RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
const start = 2147483600, end = 2147483700;
const expected = [];
for (let n = start; n <= end; n++) {
    let prime = true;
    for (let divisor = 2; divisor * divisor <= n; divisor++) {
        if (n % divisor === 0) { prime = false; break; }
    }
    if (prime) expected.push(BigInt(n));
}
const began = performance.now();
const plan = densePrimePlan(BigInt(end)).withLowerBound(BigInt(start), true);
const diagnostics = new RuntimeDiagnostics();
const result = diagnostics.run(() => materializeSequence({ kind: 'sequence', plan }));
const actual = Array.from({ length: result.shape[0] }, (_, i) => readArrayItem(result, i));
assert.deepEqual(actual, expected);
assert.ok(actual.some(n => n > 2147483647n));
assert.equal(diagnostics.nativeSequenceCopies, 0);
console.log(JSON.stringify({ cases: actual.length, first: String(actual[0]), last: String(actual.at(-1)),
    ms: performance.now() - began, maxRssMiB: process.resourceUsage().maxRSS / 1024, arch: process.arch }));
