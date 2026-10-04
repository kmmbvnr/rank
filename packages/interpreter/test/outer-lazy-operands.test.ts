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
        // A computed operand has no arithmetic shortcut, but only the first cell's operands are read.
        expect(run('use sequences\nZ = ((1 to 5000000) * 2)\nT = Z Z outer *\nT shape')).toBe('5000000 5000000');
    });

    it('says when the table has more cells than can be numbered', () => {
        expect(() => run('F = 1 to 200000000\nF F outer *')).toThrow(/outer result is too large/);
    });
});
