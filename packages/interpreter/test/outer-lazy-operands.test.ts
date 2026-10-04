import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('outer over sequences stays lazy', () => {
    it('does not read the operands of a range to build the table', () => {
        // 10^7 by 10^7 cells: reading either operand would take seconds and gigabytes.
        const started = Date.now();
        expect(run('use sequences\nF = 100 to 9999999\nT = F F outer *\nT shape')).toBe('9999900 9999900');
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('reads a stepped, descending and exclusive range by arithmetic', () => {
        expect(run('(1 to 9 by 4) (10 till 7 by -1) outer +')).toBe('11 10 9 15 14 13 19 18 17');
    });

    it('reads an exact-size operand only as far as a cell asks', () => {
        expect(run('use sequences\nZ = ((1 to 5000000) * 2)\nT = Z Z outer *\nT shape')).toBe('5000000 5000000');
    });

    it('says when the table has more cells than can be numbered', () => {
        expect(() => run('F = 1 to 200000000\nF F outer *')).toThrow(/outer result is too large/);
    });

    it('addresses arithmetic over a range, so the operand is not read either', () => {
        const started = Date.now();
        expect(run('use sequences\nR = 1 to 9999999\nS = (R * 2 + 1) (3 * R) outer -\nS shape')).toBe('9999999 9999999');
        expect(run('A = (1 to 4) * 2 + 1\nB = (10 to 12) - (1 to 3)\nA B outer +')).toBe('12 12 12 14 14 14 16 16 16 18 18 18');
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('addresses an item of a computed range without walking it', () => {
        expect(run('((1 to 1000000000000) * 3 + 1) 999999999999')).toBe('3000000000001');
    });
});

describe('an array too large to hold', () => {
    it('says how many cells it would need instead of a JavaScript RangeError', () => {
        expect(() => run('use sequences\nF = 100 to 99999\nF F outer * copy')).toThrow(/array is too large to hold in memory/);
    });
});

describe('reductions stream over a lazy table', { timeout: 60000 }, () => {
    // 1200 x 1200 = 1.44 million cells: past the size where a reduction collects the table first.
    const setup = 'use sequences\nuse stats\nF = 1 to 1200\nT = F F outer *\n';

    it('sums, finds the extremes and averages a large table one cell at a time', () => {
        expect(run(setup + 'T sum')).toBe('519264360000');
        expect(run(setup + 'T max')).toBe('1440000');
        expect(run(setup + 'T min')).toBe('1');
        expect(run(setup + 'T mean')).toBe('360600.25');
    });

    it('sums the whole table through `sum rank 2` without collecting it', () => {
        expect(run(setup + 'T sum rank 2')).toBe('519264360000');
    });

    it('counts a streamed comparison', () => {
        let expected = 0;
        for (let a = 1; a <= 1200; a += 1) for (let b = 1; b <= 1200; b += 1) if (a * b > 1000000) expected += 1;
        expect(run(setup + '(T greater 1000000) count')).toBe(String(expected));
    });

    it('streams a named-function outer table too', () => {
        expect(run('use sequences\nF = 1 to 1200\nF F outer max sum')).toBe('1152719800');
    });

    it('keeps the same sum for a small table', () => {
        expect(run('use sequences\nF = 1 to 30\n(F F outer *) sum')).toBe('216225');
    });
});
