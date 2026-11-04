import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/401_sumsquares.ra', import.meta.url), 'utf8');
const modulus = 1000000000n;
function solve(limit: bigint, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`] });
    try {
        runtime.execute(source);
        return runtime.variables.get('Answer');
    } finally { runtime.dispose(); }
}
function enumerate(limit: bigint) {
    let result = 0n;
    for (let d = 1n; d <= limit; d++) result += d * d * (limit / d);
    return result % modulus;
}
// Independent quotient-interval enumeration, rather than the demo's hyperbola
// split or its modular S2 polynomial. Intermediates are unreduced BigInts.
function grouped(limit: bigint) {
    const squares = (n: bigint) => n * (n + 1n) * (2n * n + 1n) / 6n;
    let result = 0n;
    for (let left = 1n; left <= limit;) {
        const quotient = limit / left, right = limit / quotient;
        result += quotient * (squares(right) - squares(left - 1n));
        left = right + 1n;
    }
    return result % modulus;
}

describe.each([false, true])('Euler 401 (compilation=%s)', compilation => {
    it('matches independent enumeration at zero and square boundaries', () => {
        for (const limit of [0n, 1n, 2n, 4n, 6n, 8n, 9n, 10n, 24n, 25n, 26n, 99n, 100n, 101n, 1000n]) {
            expect(solve(limit, compilation), `limit ${limit}`).toBe(enumerate(limit));
        }
    });
    it('crosses the 65536-cell batch boundary', () => {
        for (const root of [65535n, 65536n, 65537n]) {
            const limit = root * root;
            expect(solve(limit, compilation), `root ${root}`).toBe(grouped(limit));
        }
    });
    it('keeps the large existing checkpoint', () => {
        expect(solve(2000000000000n, compilation)).toBe(679233331n);
    });
    it('returns the full default golden value', () => {
        expect(solve(1000000000000000n, compilation)).toBe(281632621n);
    }, 60000);
});
