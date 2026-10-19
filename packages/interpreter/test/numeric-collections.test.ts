import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankValue, type RankArray } from '../src/index.js';
import { ownedArray, typedArray, maskedArray, readArrayItem } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';
import { numericSort, numericDistinct } from '../src/numeric-collections.js';
import { sortValue, argsortValue, argsortAxis } from '../src/modules/sequences.js';
import { uniqueValue, uniqueLength } from '../src/modules/sequence-distinct.js';

const cells = (value: RankValue): RankValue[] => {
    const array = value as RankArray;
    return Array.from({ length: array.shape[0] }, (_, i) => readArrayItem(array, i));
};
const signal = () => new Int32Array(new SharedArrayBuffer(4));

describe('stored numeric collection kernels', () => {
    it.each([
        [3n, -2n, 3n, 0n, -2n],
        [-(1n << 63n), (1n << 63n) - 1n, 1n, 1n],
        [9007199254740993n, 9007199254740992n, -9007199254740993n],
        [3.5, -2.5, 3.5, 0, Infinity, -Infinity],
        [true, false, true, false],
    ])('matches generic ordering, permutation and first occurrence for case %#', (...input) => {
        const source = ownedArray(input, [input.length], true);
        const generic: RankArray = { kind: 'array', shape: [input.length], items: [...input] };
        const d = new RuntimeDiagnostics();
        for (const descending of [false, true]) {
            const expected = withInterrupt(signal(), () => sortValue(generic, descending));
            const order = withInterrupt(signal(), () => argsortValue(generic, descending));
            expect(cells(d.run(() => sortValue(source, descending)))).toEqual(cells(expected));
            expect(cells(d.run(() => argsortValue(source, descending)))).toEqual(cells(order));
        }
        expect(cells(d.run(() => uniqueValue(source)))).toEqual(cells(uniqueValue(generic)));
        expect(d.run(() => uniqueLength(source))).toBe(uniqueLength(generic));
        expect(d.numericSorts).toBe(4);
        expect(d.numericDistincts).toBe(2);
        expect(cells(source)).toEqual(input);
    });

    it.each([
        [0, -0, 0, -0], [NaN, 2, NaN, 1],
        [1n << 80n, -(1n << 80n), 1n], [],
    ])('retains generic sorting for edge cases case %#', (...input) => {
        const source = ownedArray(input, [input.length], true);
        expect(numericSort(source, false)).toBeUndefined();
        const expected = withInterrupt(signal(), () => sortValue(source));
        expect(cells(sortValue(source))).toEqual(cells(expected));
        const host: RankArray = { kind: 'array', shape: [input.length], items: input };
        expect(cells(uniqueValue(source))).toEqual(cells(uniqueValue(host)));
        expect(uniqueLength(source)).toBe(uniqueLength(host));
    });

    it('keeps typed sources typed and does not mutate or alias them', () => {
        const buffer = new BigInt64Array([3n, 1n, 2n, 1n]);
        const source = typedArray(buffer);
        const sorted = sortValue(source) as RankArray;
        expect(buffer).toEqual(new BigInt64Array([3n, 1n, 2n, 1n]));
        sorted.items[0] = 9n;
        expect(cells(source)).toEqual([3n, 1n, 2n, 1n]);
        buffer[0] = 7n;
        expect(cells(sorted)).toEqual([9n, 1n, 2n, 3n]);
    });

    it('preserves NaN and the first signed zero in unique', () => {
        const result = cells(uniqueValue(typedArray(new Float64Array([-0, 0, NaN, NaN, 2]))));
        expect(Object.is(result[0], -0)).toBe(true);
        expect(result).toEqual([-0, NaN, 2]);
    });

    it('declines host, lazy, masked and mixed storage without speculative reads', () => {
        let reads = 0;
        const host: RankArray = { kind: 'array', shape: [2], get items() { reads++; return [2n, 1n]; } };
        const lazy: RankArray = { kind: 'array', shape: [2], items: [], itemAt() { reads++; return 1n; } };
        for (const value of [host, lazy, maskedArray(new BigInt64Array([1n, 2n]), new Uint32Array([1]))]) {
            expect(numericSort(value, false)).toBeUndefined();
            expect(numericDistinct(value)).toBeUndefined();
        }
        expect(reads).toBe(0);
        expect(numericDistinct({ kind: 'array', shape: [2], items: [1n, 1] })).toBeUndefined();
    });

    it('sorts explicit axes and keeps descending ties stable', () => {
        const matrix = ownedArray([2n, 1n, 2n, 1n, 2n, 1n], [2, 3], true);
        expect(formatValue(argsortAxis(matrix, 0, true))).toBe(formatValue(
            withInterrupt(signal(), () => argsortAxis(matrix, 0, true))));
        const d = new RuntimeDiagnostics(), runtime = new Interpreter();
        const result = d.run(() => runtime.execute('use sequences\nA = array 2 1 2 1\nA sort .descending .indexed'));
        expect(formatValue(result!)).toContain('0 2 1 3');
        expect(d.numericSorts).toBe(1);
    });

    it('does not enter native sorting with interactive cancellation', () => {
        const s = signal();
        const source = ownedArray(Array.from({ length: 8192 }, (_, i) => BigInt(i)), [8192], true);
        expect(withInterrupt(s, () => numericSort(source, false))).toBeUndefined();
        Atomics.store(s, 0, 1);
        expect(() => withInterrupt(s, () => sortValue(source))).toThrow(InterruptedError);
        Atomics.store(s, 0, 1);
        expect(() => withInterrupt(s, () => uniqueValue(source))).toThrow(InterruptedError);
        expect(readArrayItem(source, 8191)).toBe(8191n);
    });
});
