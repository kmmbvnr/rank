import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

function reversed(cells: Int32Array | BigInt64Array | Float64Array, shape: number[]) {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('X', typedArray(cells, shape));
        const result = runtime.execute('use sequences\nX reverse');
        if (result === undefined || !isRankArray(result)) throw new Error('not an array');
        const n = shape.reduce((a, b) => a * b, 1);
        return { shape: result.shape, cells: Array.from({ length: n }, (_, i) => readArrayItem(result, i)) };
    } finally { runtime.dispose(); }
}

describe('reverse of packed arrays', () => {
    it('flips Int32 cells', () => {
        expect(reversed(Int32Array.from([1, 2, 3, 4, 5]), [5])).toEqual({ shape: [5], cells: [5n, 4n, 3n, 2n, 1n] });
    });
    it('flips 64-bit cells', () => {
        expect(reversed(BigInt64Array.from([1n, 2n, 3n << 40n]), [3])).toEqual({ shape: [3], cells: [3n << 40n, 2n, 1n] });
    });
    it('flips real cells', () => {
        expect(reversed(Float64Array.from([0.5, 1.5, 2.5]), [3])).toEqual({ shape: [3], cells: [2.5, 1.5, 0.5] });
    });
    it('flips whole rows of a matrix', () => {
        expect(reversed(Int32Array.from([1, 2, 3, 4, 5, 6]), [3, 2])).toEqual({ shape: [3, 2], cells: [5n, 6n, 3n, 4n, 1n, 2n] });
    });
    it('keeps a long vector exact across checkpoints', () => {
        const n = 20000;
        const out = reversed(Int32Array.from({ length: n }, (_, i) => i * 7 - 5), [n]);
        expect(out.cells.every((x, i) => x === BigInt((n - 1 - i) * 7 - 5))).toBe(true);
    });
});
