import { describe, expect, it } from 'vitest';
import { integer32Cells, readArrayItem, typedArray, writeArrayCell } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { numericDistinct } from '../src/numeric-collections.js';
import { concatValues } from '../src/modules/sequences.js';
import { uniqueValue, uniqueLength } from '../src/modules/sequence-distinct.js';
import type { RankArray } from '../src/value.js';

const values = (value: RankArray) => Array.from({ length: value.shape[0] }, (_, i) => readArrayItem(value, i));

describe('compact integer distinct', () => {
    it.each([false, true])('keeps stable exact values and counts (countOnly=%s)', countOnly => {
        const input = Int32Array.from({ length: 16000 }, (_, i) => (i * 17) % 257 - 128);
        input[0] = -2147483648;
        input[1] = 2147483647;
        const original = input.slice();
        const source = typedArray(input);
        const expected = [...new Set(Array.from(input, BigInt))];
        const d = new RuntimeDiagnostics();
        const result = d.run(() => numericDistinct(source, countOnly));
        if (countOnly) expect(result).toBe(BigInt(expected.length));
        else {
            expect(values(result as RankArray)).toEqual(expected);
            expect(integer32Cells(result as RankArray)).toBeInstanceOf(Int32Array);
            writeArrayCell(result as RankArray, 0, 1n << 100n);
            expect(readArrayItem(source, 0)).toBe(-2147483648n);
        }
        expect(input).toEqual(original);
        expect(d.numericDistincts).toBe(1);
        expect(d.typedUnpacks).toBe(0);
    });

    it('compacts integer concat results without changing order or aliasing', () => {
        const a = typedArray(BigInt64Array.from({ length: 5000 }, (_, i) => BigInt(4999 - i)));
        const b = typedArray(new Int32Array([3, 5000, -1, 3]));
        const result = uniqueValue(concatValues([a, b])) as RankArray;
        expect(integer32Cells(result)).toBeInstanceOf(Int32Array);
        expect(values(result)).toEqual([...Array.from({ length: 5000 }, (_, i) => BigInt(4999 - i)), 5000n, -1n]);
        writeArrayCell(result, 0, 17n);
        expect(readArrayItem(a, 0)).toBe(4999n);
        writeArrayCell(b, 1, 1n << 100n);
        expect(readArrayItem(result, 5000)).toBe(5000n);
    });

    it.each([2147483648n, -(1n << 63n), (1n << 63n) - 1n, 9007199254740993n])(
        'widens integer results exactly for %s', wide => {
            const source = typedArray(BigInt64Array.from([...Array.from({ length: 5000 }, (_, i) => BigInt(i)), wide, wide]));
            const result = uniqueValue(source) as RankArray;
            expect(values(result)).toEqual([...Array.from({ length: 5000 }, (_, i) => BigInt(i)), wide]);
            expect(integer32Cells(result)).toBeUndefined();
            expect(uniqueLength(source)).toBe(5001n);
        },
    );

    it('rechecks storage after widening, type changes and host overrides', () => {
        const source = typedArray(new Int32Array([1, 1, 2]));
        expect(values(uniqueValue(source) as RankArray)).toEqual([1n, 2n]);
        writeArrayCell(source, 0, 1n << 100n);
        expect(values(uniqueValue(source) as RankArray)).toEqual([1n << 100n, 1n, 2n]);
        source.items[0] = 3.5;
        expect(numericDistinct(source)).toBeUndefined();
        const host = typedArray(new Int32Array([1, 2]));
        let reads = 0;
        Object.defineProperty(host, 'itemAt', { value: () => { reads++; return 7n; }, configurable: true });
        expect(numericDistinct(host)).toBeUndefined();
        expect(reads).toBe(0);
        expect(values(uniqueValue(host) as RankArray)).toEqual([7n]);
    });

    it.each([false, true])('keeps cancellation and source storage intact (countOnly=%s)', countOnly => {
        const source = typedArray(Int32Array.from({ length: 16000 }, (_, i) => i));
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => numericDistinct(source, countOnly))).toThrow(InterruptedError);
        expect(readArrayItem(source, 15999)).toBe(15999n);
        expect(integer32Cells(source)).toBeInstanceOf(Int32Array);
    });
});
