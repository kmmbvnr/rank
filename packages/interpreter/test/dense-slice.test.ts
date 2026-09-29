import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const run = (source: string) => {
    const runtime = new Interpreter();
    try { return runtime.execute(source); } finally { runtime.dispose(); }
};

// 300 x 300 is above the size at which a slice is copied at once.
const matrix = 'M = array shape 300 300 fill 2\nM 0 0 = 7\nM 299 299 = 9\n';

describe('large slices of stored arrays', () => {
    it('takes a column and a row with the same values as a small slice', () => {
        expect(run(`${matrix}C = M # 0\nC sum`)).toBe(7n + 299n * 2n);
        expect(run(`${matrix}R = M 299 #\nR sum`)).toBe(299n * 2n + 9n);
        expect(run('M = array shape 3 3 fill 2\nM 0 0 = 7\nC = M # 0\nC sum')).toBe(11n);
    });

    it('selects rows by a mask', () => {
        expect(run(`${matrix}K = array shape 300 fill true\nS = M K #\nS 0 0`)).toBe(7n);
    });

    it('is a value: a later write to the source does not reach a large slice', () => {
        expect(run(`${matrix}S = M # #\nM 0 0 = 100\nS 0 0`)).toBe(7n);
    });
});

describe('slices of a typed array of reals', () => {
    // Cell (i, j, k) of a 10 x 12 x 10 array holds 1 + 120 i + 10 j + k, as a real.
    // The second product is real times real, so M is held in a typed buffer.
    const cube = 'use sequences\nP = (1 to 1200) (array 10 12 10) reshape * 1.0\nM = P * 1.0\n';
    const cell = (i: number, j: number, k: number) => 1 + 120 * i + 10 * j + k;
    const sum = (rows: number[], columns: number[], depths: number[]) => {
        let total = 0;
        for (const i of rows) for (const j of columns) for (const k of depths) total += cell(i, j, k);
        return total;
    };
    const range = (count: number) => Array.from({ length: count }, (_, index) => index);

    it('takes a plane along each axis', () => {
        expect(run(`${cube}(M 3 # #) sum`)).toBe(sum([3], range(12), range(10)));
        expect(run(`${cube}(M # 5 #) sum`)).toBe(sum(range(10), [5], range(10)));
        expect(run(`${cube}(M # # 7) sum`)).toBe(sum(range(10), range(12), [7]));
    });

    it('takes a line and reads a cell of it', () => {
        expect(run(`${cube}(M 2 3 #) sum`)).toBe(sum([2], [3], range(10)));
        expect(run(`${cube}(M 2 # 4) sum`)).toBe(sum([2], range(12), [4]));
        expect(run(`${cube}(M # 6 4) sum`)).toBe(sum(range(10), [6], [4]));
        expect(run(`${cube}(M # 6 4) 3`)).toBe(cell(3, 6, 4));
    });

    it('selects by index vectors along an axis', () => {
        expect(run(`${cube}(M (array 1 4 8) # #) sum`)).toBe(sum([1, 4, 8], range(12), range(10)));
        expect(run(`${cube}(M # (array 0 11) #) sum`)).toBe(sum(range(10), [0, 11], range(10)));
        expect(run(`${cube}(M # # (array 9 0 5)) sum`)).toBe(sum(range(10), range(12), [9, 0, 5]));
        expect(run(`${cube}(M (array 2 7) # (array 3 1)) sum`)).toBe(sum([2, 7], range(12), [3, 1]));
    });

    it('is a value: a write to the source or the slice reaches neither', () => {
        expect(run(`${cube}S = M 3 # #\nM 3 0 0 = 0.0\nS 0 0`)).toBe(cell(3, 0, 0));
        expect(run(`${cube}S = (M 3 # #) copy\nS 0 0 = 0.0\nM 3 0 0`)).toBe(cell(3, 0, 0));
    });
});
