import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/593_fleetingmedians.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler593-original.ra', import.meta.url), 'utf8');
function run(text: string, n: number, k: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--n=${n}`, `--k=${k}`] });
    try { runtime.execute(text); return answerOf(runtime); }
    finally { runtime.dispose(); }
}
function brute(n: number, width: number) {
    const primes: number[] = [];
    for (let p = 2; primes.length < n; p++) {
        let prime = true;
        for (let divisor = 2; divisor * divisor <= p; divisor++) if (p % divisor === 0) { prime = false; break; }
        if (prime) primes.push(p);
    }
    const powers = primes.map((p, i) => {
        let exponent = i + 1, base = p % 10007, result = 1;
        while (exponent) { if (exponent % 2) result = result * base % 10007; base = base * base % 10007; exponent = Math.floor(exponent / 2); }
        return result;
    });
    const values = powers.map((value, i) => value + powers[Math.floor((i + 1) / 10000)]);
    let total = 0;
    for (let start = 0; start + width <= n; start++) {
        const sorted = values.slice(start, start + width).sort((a, b) => a - b);
        total += (sorted[Math.floor((width - 1) / 2)] + sorted[Math.floor(width / 2)]) / 2;
    }
    return total.toFixed(1);
}
describe.each([false, true])('Euler 593 (compilation=%s)', compilation => {
    it.each([[1, 1], [2, 1], [2, 2], [10, 3], [10, 10], [100, 10], [101, 11], [1231, 17], [10007, 501]])
    ('matches direct prime powers and sorted windows, N=%s K=%s', (n, k) => {
        expect(run(source, n, k, compilation)).toBe(brute(n, k));
    });
    it.each([[10, 1], [100, 10], [10000, 17], [100000, 10000]])
    ('matches the original count-pointer program, N=%s K=%s', (n, k) => {
        expect(run(source, n, k, compilation)).toBe(run(original, n, k, true));
    });
    it('keeps the full golden answer', () => {
        expect(run(source, 10000000, 100000, compilation)).toBe('96632320042.0');
    }, 30000);
    it.each([[0, 1], [10, 0], [2, 3]])('rejects invalid input N=%s K=%s', (n, k) => {
        expect(() => run(source, n, k, compilation)).toThrow('need 1 <= K <= N');
    });
});
