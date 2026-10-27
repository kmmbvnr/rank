import { describe, expect, it, vi } from 'vitest';
import { integer32Cells, readArrayItem, typedArray, writeArrayCell } from '../src/array-storage.js';
import { createOwned } from '../src/owned-array.js';
import { MISSING, type RankArray } from '../src/value.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';

describe('ordinary packed integer reads', () => {
    it('reads exact integers without unpacking the buffer', () => {
        const array = typedArray(new Int32Array([-2147483648, -1, 0, 2147483647]));
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => {
            expect([0, 1, 2, 3].map(index => readArrayItem(array, index)))
                .toEqual([-2147483648n, -1n, 0n, 2147483647n]);
        });
        expect(integer32Cells(array)).toBeInstanceOf(Int32Array);
        expect(diagnostics.typedUnpacks).toBe(0);
    });

    it('observes missing cells and later writes', () => {
        const array = createOwned(new Int32Array([3, 7]), [2], false, undefined, new Uint32Array([1]));
        expect(readArrayItem(array, 0)).toBe(3n);
        expect(readArrayItem(array, 1)).toBe(MISSING);
        writeArrayCell(array, 1, 9n);
        expect(readArrayItem(array, 1)).toBe(9n);
    });

    it('follows widening, arbitrary precision and public item writes', () => {
        const array = typedArray(new Int32Array([1, 2]));
        expect(readArrayItem(array, 0)).toBe(1n);
        writeArrayCell(array, 0, 2147483648n);
        expect(readArrayItem(array, 0)).toBe(2147483648n);
        writeArrayCell(array, 1, 1n << 100n);
        expect(readArrayItem(array, 1)).toBe(1n << 100n);
        array.items[0] = 'changed';
        expect(readArrayItem(array, 0)).toBe('changed');
    });

    it('keeps unchecked invalid reads on their existing undefined path', () => {
        const array = typedArray(new Int32Array([1]));
        for (const index of [-1, 1, 0.5, NaN, Infinity]) expect(readArrayItem(array, index)).toBeUndefined();
    });

    it('honors installed host readers without consulting packed storage', () => {
        const array = typedArray(new Int32Array([1]));
        const itemAt = vi.fn(() => 42n);
        Object.defineProperty(array, 'itemAt', { value: itemAt, configurable: true });
        expect(readArrayItem(array, 0)).toBe(42n);
        expect(itemAt).toHaveBeenCalledExactlyOnceWith(0);
    });

    it('preserves foreign reader order and exceptions', () => {
        const itemAt = vi.fn((index: number) => {
            if (index === 1) throw new Error('foreign reader');
            return 7n;
        });
        const array: RankArray = { kind: 'array', shape: [2], items: [], itemAt };
        expect(itemAt).not.toHaveBeenCalled();
        expect(readArrayItem(array, 0)).toBe(7n);
        expect(() => readArrayItem(array, 1)).toThrow('foreign reader');
        expect(itemAt.mock.calls).toEqual([[0], [1]]);
    });
});
