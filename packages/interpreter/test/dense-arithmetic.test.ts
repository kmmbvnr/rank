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

    it('combines a large array with a small lazy one', () => {
        const source = 'use stats\nX = array shape 2000 5 fill 1.5\nC = X mean axis 0\nZ = X - C\nZ sum';
        expect(run(source)).toBe(0);
    });

    it('still reports a shape mismatch', () => {
        expect(() => run('M = array shape 100 20 fill 2\nV = array shape 7 fill 3\nM * V')).toThrow('shape mismatch');
    });
});

describe('dense matrix kernels', () => {
    it('multiplies stored matrices like the lazy path', () => {
        expect(run('use linalg\nM = array shape 100 20 fill 2\nV = array shape 20 fill 3\nR = M V matmul\nR sum')).toBe(12000n);
        expect(run('use linalg\nM = array shape 4 2 fill 2\nV = array shape 2 fill 3\nR = M V matmul\nR sum')).toBe(48n);
    });

    it('keeps reals and integers apart as the lazy path does', () => {
        expect(run('use linalg\nM = array shape 100 20 fill 2.0\nV = array shape 20 fill 3\nR = M V matmul\nR sum')).toBe(12000);
    });

    it('permutes a stored matrix', () => {
        expect(run('use sequences\nM = array shape 100 20 fill 1\nM 3 5 = 7\nT = M transpose\nT 5 3')).toBe(7n);
    });

    it('multiplies a transposed matrix by a vector', () => {
        const source = 'use linalg\nuse sequences\nM = array shape 100 20 fill 1\nT = M transpose\n'
            + 'V = array shape 100 fill 2\nR = T V matmul\nR sum';
        expect(run(source)).toBe(4000n);
    });

    it('maps a large array through a numeric function', () => {
        expect(run('use numbers\nR = array shape 2000 fill 4.0\nS = R sqrt\nS sum')).toBe(4000);
    });
});
