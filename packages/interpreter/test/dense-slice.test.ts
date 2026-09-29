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
