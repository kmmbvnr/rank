import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { readArrayItem, typedArray } from '../src/array-storage.js';

type Cells = Int32Array | BigInt64Array | Float64Array;

function run(cells: Cells, shape: number[], code: string) {
    const runtime = new Interpreter();
    try {
        runtime.variables.set('X', typedArray(cells, shape));
        const result = runtime.execute(`use sequences\n${code}`);
        if (result === undefined || !isRankArray(result)) throw new Error('not an array');
        const n = shape.reduce((a, b) => a * b, 1);
        return { shape: result.shape, cells: Array.from({ length: n }, (_, i) => readArrayItem(result, i)) };
    } finally { runtime.dispose(); }
}

/** np.roll reference on a row-major array. */
function roll(values: unknown[], shape: number[], count: number, axis: number) {
    const inner = shape.slice(axis + 1).reduce((a, b) => a * b, 1);
    const rows = shape[axis];
    return values.map((_, at) => {
        const outer = Math.floor(at / (rows * inner));
        const row = Math.floor(at / inner) % rows;
        const from = (((row - count) % rows) + rows) % rows;
        return values[outer * rows * inner + from * inner + (at % inner)];
    });
}

describe('rotate', () => {
    it('moves a vector right for positive counts', () => {
        expect(run(Int32Array.from([1, 2, 3, 4, 5]), [5], 'X rotate 2').cells).toEqual([4n, 5n, 1n, 2n, 3n]);
    });
    it('moves left for negative counts and wraps long counts', () => {
        expect(run(Int32Array.from([1, 2, 3, 4, 5]), [5], 'X rotate -1').cells).toEqual([2n, 3n, 4n, 5n, 1n]);
        expect(run(Int32Array.from([1, 2, 3, 4, 5]), [5], 'X rotate 12').cells).toEqual([4n, 5n, 1n, 2n, 3n]);
        expect(run(Int32Array.from([1, 2, 3, 4, 5]), [5], 'X rotate 0').cells).toEqual([1n, 2n, 3n, 4n, 5n]);
    });
    it('keeps 64-bit and real storage', () => {
        expect(run(BigInt64Array.from([1n, 2n, 3n << 40n]), [3], 'X rotate 1').cells).toEqual([3n << 40n, 1n, 2n]);
        expect(run(Float64Array.from([0.5, 1.5, 2.5]), [3], 'X rotate 1').cells).toEqual([2.5, 0.5, 1.5]);
    });
    it('matches np.roll for every axis, count and shape', () => {
        const shape = [3, 4, 2];
        const cells = Int32Array.from({ length: 24 }, (_, i) => i * 7 - 20);
        const values = Array.from(cells, v => BigInt(v));
        for (const axis of [0, 1, 2]) {
            for (const count of [-9, -1, 0, 1, 2, 5, 13]) {
                const code = axis === 0 ? `X rotate ${count}` : `X rotate ${count} axis ${axis}`;
                const got = run(cells, shape, code.replace('rotate -', 'rotate -'));
                expect(got.cells, code).toEqual(roll(values, shape, count, axis));
                expect(got.shape).toEqual(shape);
            }
        }
    });
    it('rotates a long vector exactly', () => {
        const n = 20000;
        const cells = Int32Array.from({ length: n }, (_, i) => i);
        const got = run(cells, [n], 'X rotate 7777').cells;
        expect(got.slice(0, 3)).toEqual([BigInt(n - 7777), BigInt(n - 7776), BigInt(n - 7775)]);
        expect(got[7777]).toBe(0n);
    });
    it('rejects non-integer counts and bad axes', () => {
        expect(() => run(Int32Array.from([1, 2]), [2], 'X rotate 1.5')).toThrow();
        expect(() => run(Int32Array.from([1, 2]), [2], 'X rotate 1 axis 3')).toThrow();
    });
    it('needs use sequences', () => {
        const runtime = new Interpreter();
        try {
            runtime.variables.set('X', typedArray(Int32Array.from([1, 2]), [2]));
            expect(() => runtime.execute('X rotate 1')).toThrow();
        } finally { runtime.dispose(); }
    });
});
