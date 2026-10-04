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
        expect(() => run('use sequences\nF = 100 to 99999\nF F outer * sum')).toThrow(/array is too large to hold in memory: 9980010000 cells/);
    });
});
