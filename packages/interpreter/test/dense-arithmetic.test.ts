import { describe, expect, it } from 'vitest';
import { Interpreter, RankError } from '../src/index.js';

const run = (source: string) => {
    const runtime = new Interpreter();
    try { return runtime.execute(source); } finally { runtime.dispose(); }
};

// Large enough to be computed at once rather than kept as a lazy layer.
const setup = 'A = array shape 2000 fill 3\nZ = array shape 2000 fill 0\n';

describe('elementwise arithmetic on large stored arrays', () => {
    it('gives the same values as the small lazy path', () => {
        expect(run(`${setup}B = A * 2 + 1\nB sum`)).toBe(14000n);
        expect(run('A = array shape 4 fill 3\nB = A * 2 + 1\nB sum')).toBe(28n);
    });

    it('promotes integers with reals like the lazy path', () => {
        expect(run(`${setup}B = A / 2.0\nB sum`)).toBe(3000);
    });

    it('is a value: a later write to the source does not reach the result', () => {
        expect(run(`${setup}B = A + 1\nA 0 = 100\nB 0`)).toBe(4n);
    });

    it('keeps an integer division by zero lazy until a cell is read', () => {
        expect(run(`${setup}Q = A / Z\n1`)).toBe(1n);
        expect(() => run(`${setup}Q = A / Z\nQ 0`)).toThrow(RankError);
    });

    it('lets choose skip the cells that would divide by zero', () => {
        expect(run(`use sequences\n${setup}Q = A / Z\nM = Z equal 0\nR = M A Q choose\nR sum`)).toBe(6000n);
    });

    it('broadcasts a row over a matrix', () => {
        expect(run('M = array shape 100 20 fill 2\nV = array shape 20 fill 3\nR = M * V\nR sum')).toBe(12000n);
    });

    it('still reports a shape mismatch', () => {
        expect(() => run('M = array shape 100 20 fill 2\nV = array shape 7 fill 3\nM * V')).toThrow('shape mismatch');
    });
});
