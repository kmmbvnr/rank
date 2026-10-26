import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/129_repunitdiv.ra', import.meta.url), 'utf8');
// Independent multiplicative-order calculation modulo 9n, using Euler's
// totient and prime-factor removal instead of successive repunit remainders.
function factors(n: number): number[] {
    const result = [];
    for (let p = 2; p * p <= n; p++) if (n % p === 0) {
        result.push(p);
        while (n % p === 0) n /= p;
    }
    if (n > 1) result.push(n);
    return result;
}
function power(base: bigint, exponent: number, modulus: bigint): bigint {
    let result = 1n;
    while (exponent) {
        if (exponent % 2) result = result * base % modulus;
        base = base * base % modulus;
        exponent = Math.floor(exponent / 2);
    }
    return result;
}
function order(n: number): number {
    const m = 9 * n;
    let phi = m;
    for (const p of factors(m)) phi = phi / p * (p - 1);
    let k = phi;
    for (const p of factors(phi)) while (k % p === 0 && power(10n, k / p, BigInt(m)) === 1n) k /= p;
    return k;
}

describe.each([false, true])('Euler 129 remainder search (compilation=%s)', compilation => {
    it.each([0, 1, 2, 3, 5, 6, 10, 20, 50, 100, 1000])('agrees with exact orders at limit %i', limit => {
        const candidates = Array.from({ length: 30 }, (_, i) => limit + i + 1);
        const expected = candidates.find(n => n % 2 && n % 5 && order(n) > limit)!;
        expect(expected).toBeDefined();
        const output: string[] = [];
        const r = new Interpreter(line => output.push(line), { compilation, args: [`--limit=${limit}`] });
        try {
            r.execute(source);
            expect(r.variables.get('Answer')).toBe(BigInt(expected));
            expect(output).toEqual([String(expected)]);
        } finally { r.dispose(); }
    });

    it('does not evaluate candidates following the first match', () => {
        const output: string[] = [];
        const r = new Interpreter(line => output.push(line), { compilation, args: ['--limit=10'] });
        try {
            r.execute(source.replace('fun N exceeds_limit', 'fun N exceeds_limit\n  N print'));
            // Rank's shape discovery can revisit its first cell; it must never
            // inspect a candidate beyond the first successful mask cell.
            expect([...new Set(output)]).toEqual(['11', '12', '13', '14', '15', '16', '17']);
            expect(output.at(-1)).toBe('17');
        } finally { r.dispose(); }
    });

    it('retains failure when the requested window contains no match', () => {
        const r = new Interpreter(undefined, { compilation, args: ['--limit=10', '--window=6'] });
        try { expect(() => r.execute(source)).toThrow(); }
        finally { r.dispose(); }
    });
});
