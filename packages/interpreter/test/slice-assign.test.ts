import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const loop = (init: string, statement: string, show: string, times = 2) =>
    run(`use sequences\nuse io\n${init}\nfor R in 1 to ${times}\n  ${statement}\nend\n${show} print`).trim();

describe('slice assignment from stored cells', () => {
    it('copies a stored slice into a slice', () => {
        expect(loop('Xs = (0 to 199) * 3 + 1', 'Xs (0 to 99) = Xs (100 to 199)', 'Xs sum')).toBe('89900');
    });

    it('reads the whole right side before an overlapping write', () => {
        const init = 'Xs = (0 to 9) * 5';
        expect(loop(init, 'Xs (1 to 9) = Xs (0 to 8)', 'Xs', 1)).toBe('0 0 5 10 15 20 25 30 35 40');
        expect(loop(init, 'Xs (0 to 8) += Xs (1 to 9)', 'Xs', 1)).toBe('5 15 25 35 45 55 65 75 85 45');
    });

    it('handles constant strides on either side', () => {
        const init = 'Xs = 0 to 9\nYs = (0 to 9) * 10';
        expect(loop(init, 'Xs (0 to 8 by 2) = Ys (1 to 9 by 2)', 'Xs', 1)).toBe('10 1 30 3 50 5 70 7 90 9');
        expect(loop(init, 'Xs (0 to 4) += Ys (0 to 8 by 2)', 'Xs', 1)).toBe('0 21 42 63 84 5 6 7 8 9');
    });

    it('widens past Int32 when a sum overflows', () => {
        const init = 'Xs = array shape 8 fill 2000000000\nYs = array shape 8 fill 2000000000';
        expect(loop(init, 'Xs (0 to 7) += Ys (0 to 7)', 'Xs 7')).toBe('6000000000');
    });

    it('rejects a right side of the wrong length', () => {
        const init = 'Xs = array shape 8 fill 1\nYs = array shape 8 fill 1';
        expect(() => loop(init, 'Xs (0 to 4) = Ys (0 to 5)', 'Xs')).toThrow('mismatch');
    });

    it('widens an Int32 destination without losing signs or other cells', () => {
        const out = run(`use sequences
use io
Xs = array shape 6 fill -5
Ys = array shape 3 fill 3000000000
Xs (0 to 2) = Ys
Xs print`).trim();
        expect(out).toBe('3000000000 3000000000 3000000000 -5 -5 -5');
        const sums = run(`use sequences
use io
Xs = array shape 6 fill 2000000000
Ys = array shape 3 fill 2000000000
Xs (0 to 2) += Ys
Xs print`).trim();
        expect(sums).toBe('4000000000 4000000000 4000000000 2000000000 2000000000 2000000000');
    });

    it('binds a strided slice as an independent copy', () => {
        const out = run(`use sequences
use io
Ts = 0 to 9
Tl = Ts (0 to 8 by 2)
Ts 0 = 99
(Tl sum) * 1000 + Ts 0 print`).trim();
        expect(out).toBe('20099');
    });
});
