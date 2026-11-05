import { describe, expect, it } from 'vitest';
import { mapStoredIntegers } from '../src/jit/integer-array-kernel.js';
import { integer32Cells, readArrayItem, sliceStoredArray, typedArray } from '../src/array-storage.js';
import { broadcastOffset, arrayStrides, broadcastShape } from '../src/jit/tensor-layout.js';
import type { RankArray } from '../src/value.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

describe('compact broadcast products', () => {
    it.each([
        [[2, 3, 1], [2, 1, 5]], [[1, 3, 5], [2, 3, 1]],
        [[3, 1], [5]], [[5], [3, 1]], [[1, 5], [2, 3, 1]],
        [[], [3, 5]], [[3, 5], []], [[2, 3, 1], [1, 3, 1]],
        [[2, 0, 1], [1, 1, 5]], [[2, 3, 1], [2, 1, 0]],
    ])('matches exact multiplication for %j and %j', (aShape, bShape) => {
        const make = (shape: number[]) => typedArray(Int32Array.from(
            { length: shape.reduce((a, b) => a * b, 1) }, (_, i) => i % 7 - 3), shape);
        const left = make(aShape), right = make(bShape);
        const shape = broadcastShape(aShape, bShape);
        const result = mapStoredIntegers(left, right, '*')!;
        expect(result.shape).toEqual(shape);
        for (let i = 0; i < shape.reduce((a, b) => a * b, 1); i++) {
            const a = readArrayItem(left, broadcastOffset(i, shape, aShape, arrayStrides(aShape))) as bigint;
            const b = readArrayItem(right, broadcastOffset(i, shape, bShape, arrayStrides(bShape))) as bigint;
            expect(readArrayItem(result, i)).toBe(a * b);
        }
        if (shape.every(n => n > 0)) expect(integer32Cells(result)).toBeDefined();
    });

    it('preserves offsets in shared stored views', () => {
        const source = typedArray(Int32Array.from([99, 2, 3, 4, 5, 6, 7, 99]));
        const left = sliceStoredArray(source, 1, [2, 1, 3])!;
        const right = typedArray(new Int32Array([1, -1, 2, -2]), [1, 4, 1]);
        const result = mapStoredIntegers(left, right, '*')!;
        expect(Array.from({ length: 24 }, (_, i) => readArrayItem(result, i)))
            .toEqual([2n, 3n, 4n, -2n, -3n, -4n, 4n, 6n, 8n, -4n, -6n, -8n,
                5n, 6n, 7n, -5n, -6n, -7n, 10n, 12n, 14n, -10n, -12n, -14n]);
        expect(readArrayItem(source, 0)).toBe(99n);
    });

    it('widens a product outside Int32 without changing either input', () => {
        const left = typedArray(new Int32Array([1, 2147483647]), [2, 1]);
        const right = typedArray(new Int32Array([1, 3, -2, 0, 1]), [1, 5]);
        const result = mapStoredIntegers(left, right, '*') as RankArray;
        expect([...result.items]).toEqual([1n, 3n, -2n, 0n, 1n, 2147483647n, 6442450941n, -4294967294n, 0n, 2147483647n]);
        expect(readArrayItem(left, 1)).toBe(2147483647n);
    });

    it('polls cancellation inside a long broadcast row', () => {
        const left = typedArray(new Int32Array([2, 3]), [2, 1]);
        const right = typedArray(new Int32Array(100000).fill(4), [1, 100000]);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => mapStoredIntegers(left, right, '*')))
            .toThrow(InterruptedError);
        expect(readArrayItem(left, 0)).toBe(2n);
    });
});
