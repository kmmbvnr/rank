import { fullScale } from './full-scale.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/578_decreasingprimepowers.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler578-original.ra', import.meta.url), 'utf8');
// Factor every small integer directly; neither squarefree inversion nor
// powerful-prefix enumeration enters this independent definition check.
const bound = 20000, prefix = new Int32Array(bound + 1), spf = new Int32Array(bound + 1);
for (let p = 2; p <= bound; p++) if (!spf[p]) for (let n = p; n <= bound; n += p) if (!spf[n]) spf[n] = p;
for (let n = 1; n <= bound; n++) {
    let rest = n, previous = Infinity, valid = true;
    while (rest > 1) {
        const p = spf[rest]; let exponent = 0;
        while (rest % p === 0) { rest /= p; exponent++; }
        if (exponent > previous) { valid = false; break; }
        previous = exponent;
    }
    prefix[n] = prefix[n - 1] + Number(valid);
}
function run(n: number, options: InterpreterOptions = {}, text = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(text); return answerOf(runtime); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { scalarFunctionCompilation: false, numberLoopCompilation: false }])('Euler 578 %j', options => {
    it.each([0, 1, 2, 3, 4, 10, 17, 18, 49, 50, 54, 75, 90, 98, 100, 1000, 10000, 20000])('matches direct factorization through %s', n => {
        expect(run(n, options)).toBe(BigInt(prefix[n]));
    }, 60000);
    it('retains the million checkpoint', () => expect(run(1000000, options)).toBe(922052n), 60000);
});
it.each([100, 1000000, 1000000000])('matches the original independent prime-count search through %s', n => {
    expect(run(n)).toBe(run(n, {}, original));
}, 60000);
fullScale('retains the full default golden with compiled read-only recursion', () => {
    expect(run(10000000000000)).toBe(9219696799346n);
}, 360000);
it.each([0, 25, 100])('keeps the cache cutoff %s separate from mathematical bounds', cut => {
    const changed = source.replace('Root min 10000', `Root min ${cut}`);
    expect(run(20000, {}, changed)).toBe(BigInt(prefix[20000]));
});
