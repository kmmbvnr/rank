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

describe('dense kernels for broadcasting, powers, comparisons and choose', () => {
    const grid = 'use sequences\nM = array shape 100 20 fill 2.0\nC = (0 till 100) reshape 100 1\n';

    it('broadcasts a column over a table', () => {
        expect(run(`${grid}R = M + C\nR sum`)).toBe(2 * 2000 + 20 * 4950);
        expect(run(`${grid}R = M + C\n(R 3) sum`)).toBe(2 * 20 + 20 * 3);
        expect(run('use sequences\nB = array shape 100 20 fill 2\nK = (0 till 100) reshape 100 1\nR = B * K\nR sum')).toBe(2n * 20n * 4950n);
    });

    it('broadcasts a column and a row into a table', () => {
        const source = 'use sequences\nC = (0 till 50) reshape 50 1\nR = (0 till 40) reshape 1 40\nT = C * 1.0 + R\nT sum';
        expect(run(source)).toBe(40 * 1225 + 50 * 780);
    });

    it('raises reals to powers, integers to reals, and reports what is not real', () => {
        expect(run('A = array shape 2000 fill 3.0\nB = A ** 2.0\nB sum')).toBe(18000);
        expect(run('A = array shape 2000 fill 3\nB = A ** 0.5\nB 0')).toBe(3 ** 0.5);
        expect(() => run('A = array shape 2000 fill -8.0\nB = A ** 0.5\nB 0')).toThrow(RankError);
        expect(() => run('A = array shape 2000 fill 0.0\nB = A ** -1.0\nB 0')).toThrow(RankError);
    });

    it('adds integers to reals as reals', () => {
        expect(run('A = array shape 2000 fill 3\nB = A - 3.5\nB sum')).toBe(-1000);
        expect(run('A = array shape 2000 fill 3\nB = A / 2.0\nB 0')).toBe(1.5);
    });

    it('compares reals and integers with reals', () => {
        expect(run('use sequences\nA = array shape 2000 fill 3.0\nB = A less 4.0\n(B count)')).toBe(2000n);
        expect(run('A = array shape 2000 fill 3.0\nB = A at least 4.0\nB 0')).toBe(false);
        expect(run('A = array shape 2000 fill 3\nB = A less 3.5\nB 0')).toBe(true);
    });

    it('chooses between stored cells and keeps unread branches unread', () => {
        const source = [
            'use sequences', 'use numbers',
            'Rate = (0 till 3000) reshape 3000 * 0.5',
            'Zero = Rate less 0.25',
            'Inverse = 1.0 / Rate',
            'R = Zero 0.0 Inverse choose',
            'R sum',
        ].join('\n');
        expect(() => run(source)).not.toThrow();
        const expected = Array.from({ length: 2999 }, (_, i) => 1 / ((i + 1) * 0.5)).reduce((a, b) => a + b, 0);
        expect(run(source) as number).toBeCloseTo(expected, 9);
    });

    it('chooses with a column against a table and with scalar branches', () => {
        expect(run('use sequences\nC = (0 till 100) reshape 100 1\nM = array shape 100 20 fill 1.0\nK = M less 2.0\nR = K C 0.0 choose\nR sum')).toBe(BigInt(20 * 4950));
        expect(run('use sequences\nA = array shape 3000 fill 4\nB = A greater 3\nR = B 7 9 choose\nR sum')).toBe(21000n);
    });

    it('chooses text and mixed cells without typing them as reals', () => {
        expect(run('use sequences\nA = array shape 3000 fill 4\nB = A greater 3\nR = B "yes" "no" choose\nR 0')).toBe('yes');
        expect(run('use sequences\nA = array shape 3000 fill 4\nB = A greater 3\nR = B 1 2.5 choose\nR 0')).toBe(1n);
    });

    it('rejects a condition that is not boolean', () => {
        expect(() => run('use sequences\nA = array shape 3000 fill 4\nR = A 1 2 choose\nR 0')).toThrow(RankError);
    });
});

