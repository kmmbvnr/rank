import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/421_primefactors.ra', import.meta.url), 'utf8');
const primes: number[] = [];
for (let p = 2; p <= 5000; p++) if (primes.every(q => q * q > p || p % q !== 0)) primes.push(p);
function oracle(n: bigint, m: number): bigint {
    let total = 0n;
    for (const prime of primes) {
        if (prime > m) break;
        const p = BigInt(prime);
        // Direct residue enumeration, independent of primitive roots.
        for (let x = 1n; x < p; x++) if ((x ** 15n + 1n) % p === 0n && x <= n) total += p * ((n + p - x) / p);
    }
    return total;
}
function run(n: bigint, m: number, options: InterpreterOptions = {}) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--m=${m}`] });
    try { runtime.execute(source); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
it.each([[0n, 20], [1n, 2], [2n, 10], [2n, 3], [3n, 5], [10n, 0], [10n, 1], [10n, 2], [10n, 3], [10n, 5], [10n, 20], [25n, 50], [200n, 1000], [1000n, 5000]] as const)
('matches directly enumerated roots for N=%s M=%s', (n, m) => {
    const expected = oracle(n, m);
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) expect(run(n, m, options)).toBe(expected);
});
it.each([9007199254740991n, 9007199254740993n, 10n ** 30n])('keeps exact wide counts for N=%s', n => {
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) expect(run(n, 31, options)).toBe(oracle(n, 31));
});
it('keeps the full default golden answer', () => {
    expect(run(100000000000n, 100000000)).toBe(2304215802083466198n);
}, 120_000);
