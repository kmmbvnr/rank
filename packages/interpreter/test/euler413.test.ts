import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/413_onechild.ra', import.meta.url), 'utf8');
function solve(digits: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--digits=${digits}`] });
    try { runtime.execute(source); return answerOf(runtime); }
    finally { runtime.dispose(); }
}

// Enumerate decimal substrings directly, independently of packed DP states.
function oracle(digits: number) {
    let total = 0n;
    for (let n = 1; n <= digits; n++) for (let value = 10 ** (n - 1); value < 10 ** n; value++) {
        const decimal = String(value);
        let hits = 0;
        for (let start = 0; start < n; start++) for (let end = start + 1; end <= n; end++) {
            if (Number(decimal.slice(start, end)) % n === 0) hits++;
        }
        if (hits === 1) total++;
    }
    return total;
}
const small = Array.from({ length: 6 }, (_, n) => oracle(n));

describe.each([false, true])('Euler 413 (compilation=%s)', compilation => {
    it('matches direct substring counts, including empty and one-digit bounds', () => {
        for (let digits = 0; digits <= 5; digits++) expect(solve(digits, compilation)).toBe(small[digits]);
    });
    it('preserves statement values with coprime and merging remainder maps', () => {
        expect(solve(7, compilation)).toBe(277674n);
        expect(solve(11, compilation)).toBe(86585017n);
    });
    it('preserves the full nineteen-digit answer', () => {
        expect(solve(19, compilation)).toBe(3079418648040719n);
    }, 30000);
});
