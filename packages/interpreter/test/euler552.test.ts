import { fullScale } from './full-scale.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/552_chineseleftovers2.ra', import.meta.url), 'utf8');
function literal(limit: number): bigint {
    const primes: bigint[] = [];
    for (let p = 2; p <= limit; p++) if (!primes.some(q => q * q <= BigInt(p) && BigInt(p) % q === 0n)) primes.push(BigInt(p));
    let value = 1n, product = 2n;
    const found = new Set<bigint>();
    for (let i = 1; i < primes.length; i++) {
        for (const prime of primes) if (value % prime === 0n) found.add(prime);
        while (value % primes[i] !== BigInt(i + 1)) value += product;
        product *= primes[i];
    }
    return [...found].reduce((sum, prime) => sum + prime, 0n);
}
function solve(limit: number, options: InterpreterOptions) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--l=${limit}`] });
    try { runtime.execute(source); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
const modes = [ { name: 'Number', options: {} },
    { name: 'exact', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } } ];
describe.each(modes)('Euler 552 $name', ({ options }) => {
    it.each([0, 1, 2, 3, 4, 5, 7, 11, 20, 50, 100, 200])('matches literal CRT construction at %s', limit => {
        expect(solve(limit, options)).toBe(literal(limit));
    });
    it('matches the existing fixture beyond a prefix trim', () => expect(solve(10000, options)).toBe(741693n));
    fullScale('matches the full answer', () => expect(solve(300000, options)).toBe(326227335n), 180000);
});
