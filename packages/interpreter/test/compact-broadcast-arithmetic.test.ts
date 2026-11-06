import { describe, expect, it } from 'vitest';
import { mapStoredIntegers } from '../src/jit/integer-array-kernel.js';
import { derivedArray, integer32Cells, ownedArray, readArrayItem, sliceStoredArray, typedArray } from '../src/array-storage.js';
import { registerScalarView } from '../src/integer-view.js';
import { arrayStrides, broadcastOffset, broadcastShape } from '../src/jit/tensor-layout.js';
import type { RankArray } from '../src/value.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const operations = ['+', '-', '*', 'min', 'max'] as const;
function exact(op: typeof operations[number], a: bigint, b: bigint): bigint {
    return op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === 'min' ? a < b ? a : b : a > b ? a : b;
}
function check(left: RankArray, right: RankArray, op: typeof operations[number]) {
    const result = mapStoredIntegers(left, right, op)!;
    const shape = broadcastShape(left.shape, right.shape), size = shape.reduce((a, b) => a * b, 1);
    expect(result.shape).toEqual(shape);
    for (let i = 0; i < size; i++) {
        const a = readArrayItem(left, broadcastOffset(i, shape, left.shape, arrayStrides(left.shape))) as bigint;
        const b = readArrayItem(right, broadcastOffset(i, shape, right.shape, arrayStrides(right.shape))) as bigint;
        expect(readArrayItem(result, i)).toBe(exact(op, a, b));
    }
    return result;
}

describe('compact broadcast lane arithmetic', () => {
    it.each(operations)('matches BigInt for boxed lane constants and both operand orders: %s', op => {
        const vector = typedArray(Int32Array.from({ length: 513 }, (_, i) => i - 256), [1, 1, 513]);
        const constants = ownedArray(Array.from({ length: 16 }, (_, i) => BigInt(i - 8)), [4, 4, 1], true);
        expect(integer32Cells(constants)).toBeUndefined();
        expect(integer32Cells(check(vector, constants, op))).toBeDefined();
        expect(integer32Cells(check(constants, vector, op))).toBeDefined();
    });

    it.each(operations)('borrows offsets and negative strides: %s', op => {
        const original = typedArray(Int32Array.from({ length: 515 }, (_, i) => i - 258));
        const offset = sliceStoredArray(original, 1, [1, 513])!;
        const reversed = registerScalarView(derivedArray([1, 513], [offset], i => readArrayItem(offset, 512 - i), true),
            offset, i => 512 - i, { linear: () => ({ offset: 512, stride: -1 }) });
        const wide = new BigInt64Array(2000).fill(1n << 60n);
        wide.set([1n, -1n, 2n, -2n], 100);
        const source = typedArray(wide);
        const constants = sliceStoredArray(source, 100, [4, 1])!;
        expect(integer32Cells(constants)).toBeUndefined();
        check(reversed, constants, op);
        expect(readArrayItem(source, 0)).toBe(1n << 60n);
        expect(readArrayItem(original, 0)).toBe(-258n);
    });

    it.each(operations)('retains wide exact results and constants: %s', op => {
        const vector = typedArray(new Int32Array(513).fill(2147483647), [1, 513]);
        check(vector, ownedArray([2147483647n, -2147483648n, 9007199254740993n], [3, 1], true), op);
        check(ownedArray([2147483647n, -2147483648n, 9007199254740993n], [3, 1], true), vector, op);
    });

    it('preserves the ordinary path for short, empty and nonreplicated shapes', () => {
        for (const op of operations) {
            check(typedArray(Int32Array.of(1, 2, 3), [1, 3]), ownedArray([3n, -2n], [2, 1], true), op);
            check(typedArray(new Int32Array(0), [2, 0, 1]), typedArray(Int32Array.of(1, 2, 3), [1, 1, 3]), op);
            const a = typedArray(new Int32Array(2048).fill(7), [1, 2048]);
            check(a, typedArray(new Int32Array(2048).fill(-3), [2048]), op);
        }
    });

    it('keeps cancellation and budget failure atomic and retryable', () => {
        const left = typedArray(new Int32Array(10000).fill(3), [1, 10000]);
        const right = ownedArray([1n, -1n, 2n, -2n], [4, 1], true);
        for (const op of operations) {
            expect(() => withInterrupt(new Int32Array([1]), () => mapStoredIntegers(left, right, op))).toThrow('Interrupted');
            expect(() => withDemandBudget(0, () => mapStoredIntegers(left, right, op))).toThrow('demand budget exhausted');
            expect(readArrayItem(left, 0)).toBe(3n);
            expect(readArrayItem(right, 0)).toBe(1n);
            const result = mapStoredIntegers(left, right, op)!;
            expect(readArrayItem(result, 0)).toBe(exact(op, 3n, 1n));
        }
    });
});
