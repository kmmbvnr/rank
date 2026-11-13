import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/569_primemountain.ra', import.meta.url), 'utf8');
function oracle(n: number): bigint {
    const primes: bigint[] = [];
    for (let candidate = 2; primes.length < 2 * n; candidate++) {
        let prime = true;
        for (let divisor = 2; divisor * divisor <= candidate; divisor++) if (candidate % divisor === 0) { prime = false; break; }
        if (prime) primes.push(BigInt(candidate));
    }
    const x: bigint[] = [], y: bigint[] = [];
    let position = 0n, height = 0n;
    for (let i = 0; i < primes.length; i++) {
        position += primes[i]; height += i % 2 ? -primes[i] : primes[i];
        if (i % 2 === 0) { x.push(position); y.push(height); }
    }
    let total = 0n;
    for (let peak = 1; peak < n; peak++) {
        let best = peak - 1; total++;
        for (let previous = best - 1; previous >= 0; previous--) {
            if ((y[peak] - y[previous]) * (x[peak] - x[best]) < (y[peak] - y[best]) * (x[peak] - x[previous])) {
                best = previous; total++;
            }
        }
    }
    return total;
}
function run(n: number, options: InterpreterOptions) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { runtime.execute(source); return answerOf(runtime); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 569 %j', options => {
    it.each([0, 1, 2, 3, 8, 9, 20, 100, 500])('matches an independent all-pairs visibility scan at %s peaks', n => {
        expect(run(n, options)).toBe(oracle(n));
    }, 60000);
});
it('retains the large statement fixture', () => {
    expect(run(100000, {})).toBe(650364n);
}, 60000);
