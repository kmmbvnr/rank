import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
import { readArrayItem } from '../packages/interpreter/out/array-storage.js';
const original = readFileSync(new URL('./fixtures/euler705-original.ra', import.meta.url), 'utf8');
const current = readFileSync(new URL('../demos/euler/705_inversioncount.ra', import.meta.url), 'utf8');
const run = (source, size, modulus, compilation) => {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        source = source.replace('arg Nn integer = 10 ** 8', `Nn = ${size}`)
            .replace('arg Pm integer = 1000000007', `Pm = ${modulus}`);
        diagnostics.run(() => runtime.execute(source));
        const cells = name => {
            const value = runtime.variables.get(name);
            return Array.from({ length: value.shape[0] }, (_, i) => readArrayItem(value, i));
        };
        return { answer: runtime.variables.get('Answer'),
            pairs: cells(source.includes('Pairs =') ? 'Pairs' : 'Cc'),
            counts: cells(source.includes('Counts =') ? 'Counts' : 'Cr'),
            loops: diagnostics.numberLoops };
    } finally { runtime.dispose(); }
};
let cases = 0;
for (const compilation of [false, true]) {
    for (const size of [1, 2, 3, 10, 20, 50, 99, 100, 101, 999, 1000, 1001, 10000]) {
        const expected = run(original, size, 1000000007, compilation);
        const actual = run(current, size, 1000000007, compilation);
        for (const key of ['answer', 'pairs', 'counts']) assert.deepEqual(actual[key], expected[key], `${key}, N=${size}, compilation=${compilation}`);
        if (compilation && size === 10000) assert.ok(actual.loops > 0);
        cases++;
    }
    for (const modulus of [2, 3, 5, 7, 9, 11, 15, 17, 101]) {
        assert.equal(run(current, 1000, modulus, compilation).answer,
            run(original, 1000, modulus, compilation).answer);
        cases++;
    }
}
// Independent quadratic oracle: enumerate primes by trial division, then
// enumerate every pair of nonzero decimal digits in its specified order.
const digits = [];
for (let prime = 2; prime < 1000; prime++) {
    let valid = true;
    for (let divisor = 2; divisor * divisor <= prime; divisor++) if (prime % divisor === 0) { valid = false; break; }
    if (valid) for (const digit of String(prime)) if (digit !== '0') digits.push(Number(digit) - 1);
}
const pairs = Array(81).fill(0n), counts = Array(9).fill(0n);
for (let i = 0; i < digits.length; i++) {
    counts[digits[i]]++;
    for (let j = i + 1; j < digits.length; j++) pairs[digits[i] * 9 + digits[j]]++;
}
const actual = run(current, 1000, 1000000007, true);
assert.deepEqual(actual.pairs, pairs);
assert.deepEqual(actual.counts, counts);
const large = run(current, 1000000, 1000000007, true);
const expected = run(original, 1000000, 1000000007, true);
assert.deepEqual(large.pairs, expected.pairs);
assert.deepEqual(large.counts, expected.counts);
assert.equal(large.answer, 666880282n);
const wide = run(current, 3000000, 1000000007, true);
const wideExpected = run(original, 3000000, 1000000007, true);
for (const key of ['answer', 'pairs', 'counts']) assert.deepEqual(wide[key], wideExpected[key]);
assert.ok(wide.pairs.some(count => count > 2147483647n));
console.log(JSON.stringify({ cases: cases + 3, quadraticOracleDigits: digits.length, largeAnswer: String(large.answer), wideAnswer: String(wide.answer) }));
