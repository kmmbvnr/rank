import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/531_chineseleftovers.ra', import.meta.url), 'utf8');
function gcd(a: bigint, b: bigint): bigint { return b ? gcd(b, a % b) : a; }
function phi(n: bigint) {
    let result = 0n;
    for (let candidate = 1n; candidate <= n; candidate++) if (gcd(candidate, n) === 1n) result++;
    return result;
}
// Standard CRT via extended Euclid on n and m. No gap inverse, Euler power,
// product-of-primes totient formula, pair indexing or Rank builtins.
function oracle(low: number | bigint, high: number | bigint, totient = phi) {
    const start = BigInt(low), count = Math.max(0, Number(BigInt(high) - start));
    const values = Array.from({ length: count }, (_, i) => start + BigInt(i));
    const totients = values.map(totient);
    let total = 0n;
    for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
        const n = values[i], m = values[j], a = totients[i], b = totients[j];
        let r = n, next = m, coefficient = 1n, nextCoefficient = 0n;
        while (next) {
            const quotient = r / next;
            [r, next] = [next, r - quotient * next];
            [coefficient, nextCoefficient] = [nextCoefficient, coefficient - quotient * nextCoefficient];
        }
        if ((b - a) % r) continue;
        const modulus = m / r, raw = (b - a) / r * coefficient;
        const multiplier = (raw % modulus + modulus) % modulus;
        const period = n * modulus;
        total += (a + n * multiplier) % period;
    }
    return total;
}
function trialPhi(n: bigint) {
    let remainder = n, result = n;
    for (let prime = 2n; prime * prime <= remainder; prime++) if (remainder % prime === 0n) {
        result -= result / prime;
        while (remainder % prime === 0n) remainder /= prime;
    }
    if (remainder > 1n) result -= result / remainder;
    return result;
}
const wideLow = 1n << 54n, wideExpected = oracle(wideLow, wideLow + 2n, trialPhi);
const ranges = [[1, 1], [2, 1], [1, 2], [1, 3], [2, 4], [3, 5], [4, 7], [2, 20],
    [10, 19], [19, 32], [2, 60], [1000, 1060]];
const expected = ranges.map(([low, high]) => oracle(low, high));
describe.each([
    { name: 'Number', options: {} },
    { name: 'exact compiled', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } },
])('Euler 531 $name', ({ options }) => {
    it.each(ranges.map(([low, high], i) => ({ low, high, expected: expected[i] })))(
        'matches independently computed CRT over [$low,$high)', ({ low, high, expected }) => {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--lo=${low}`, `--hi=${high}`] });
            try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(expected); }
            finally { runtime.dispose(); }
        });
    it('keeps each CRT cell exact beyond the Number input range', () => {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--lo=${wideLow}`, `--hi=${wideLow + 2n}`] });
        try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(wideExpected); }
        finally { runtime.dispose(); }
    });
});
it('checks the CRT oracle by direct search for the smallest solution', () => {
    let total = 0n;
    for (let n = 1n; n < 20n; n++) for (let m = n + 1n; m < 20n; m++) {
        const a = phi(n), b = phi(m), period = n * m / gcd(n, m);
        for (let x = 0n; x < period; x++) if (x % n === a % n && x % m === b % m) { total += x; break; }
    }
    expect(oracle(1, 20)).toBe(total);
});
it('matches the full result with an exact total beyond Number', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(4515432351156203105n);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
        expect(diagnostics.mixedIntegerLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 120_000);
