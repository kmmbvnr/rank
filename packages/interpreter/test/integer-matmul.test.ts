import { describe, expect, it } from 'vitest';
import { matmulValues } from '../src/modules/linalg.js';
import { derivedArray, filledArray, ownedArray, readArrayItem, typedArray, writeArrayCell } from '../src/array-storage.js';
import { isRankArray, type RankArray } from '../src/value.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';

describe('exact integer matrix products', () => {
    it.each([
        [999999999n, 32767n],
        [1000000000n, 1000000000n],
        [-(1n << 70n), 3n],
    ])('preserves exact dense results for %s times %s', (a, b) => {
        const n = 65;
        const result = matmulValues(filledArray(a, [n, n]), filledArray(b, [n, n]));
        expect(isRankArray(result)).toBe(true);
        if (!isRankArray(result)) throw Error('expected matrix');
        expect(result.shape).toEqual([n, n]);
        for (let i = 0; i < n * n; i++) expect(readArrayItem(result, i)).toBe(BigInt(n) * a * b);
    });

    it.each(['plain', 'int32', 'int64'] as const)('matches a signed BigInt oracle from %s storage', storage => {
        const n = 11;
        const left = Array.from({ length: n * n }, (_, i) => BigInt(i % 13 - 6) * 1000003n);
        const right = Array.from({ length: n * n }, (_, i) => BigInt(i % 7 - 3) * 32767n);
        const array = (items: bigint[]): RankArray => storage === 'plain' ? ownedArray(items, [n, n])
            : typedArray(storage === 'int32' ? Int32Array.from(items, Number) : BigInt64Array.from(items), [n, n]);
        const a = array(left), b = array(right);
        const check = (): void => {
            const result = matmulValues(a, b);
            if (!isRankArray(result)) throw Error('expected matrix');
            for (let row = 0; row < n; row++) for (let column = 0; column < n; column++) {
                let expected = 0n;
                for (let k = 0; k < n; k++) expected += left[row * n + k] * right[k * n + column];
                expect(readArrayItem(result, row * n + column)).toBe(expected);
            }
        };
        check();
        left[0] += 1n;
        writeArrayCell(a, 0, left[0]);
        check();
    });

    it.each([9007199254740991n, 9007199254740992n, 9007199254740993n,
        (1n << 63n) - 1n, 1n << 63n, 1n << 70n])('keeps boundary %s exact', value => {
        const result = matmulValues(filledArray(value, [32, 1]), filledArray(-1n, [1, 32]));
        if (!isRankArray(result)) throw Error('expected matrix');
        for (let i = 0; i < 1024; i++) expect(readArrayItem(result, i)).toBe(-value);
    });

    it('bounds intermediate products even when the final result is small', () => {
        const row = [9007199254740991n, 3n, -9007199254740991n, ...Array<bigint>(8).fill(0n)];
        const left = ownedArray(Array.from({ length: 11 }, () => row).flat(), [11, 11]);
        const result = matmulValues(left, filledArray(1n, [11, 11]));
        if (!isRankArray(result)) throw Error('expected matrix');
        for (let i = 0; i < 121; i++) expect(readArrayItem(result, i)).toBe(3n);
    });

    it('contracts non-leading tensor axes with signed values', () => {
        const left = Array.from({ length: 3 * 11 * 4 }, (_, i) => BigInt(i % 17 - 8) * 1000003n);
        const right = Array.from({ length: 5 * 11 * 2 }, (_, i) => BigInt(i % 7 - 3) * 32767n);
        const result = matmulValues(ownedArray(left, [3, 11, 4]), ownedArray(right, [5, 11, 2]), [1, 1]);
        if (!isRankArray(result)) throw Error('expected tensor');
        expect(result.shape).toEqual([3, 4, 5, 2]);
        let at = 0;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 4; b++)
            for (let c = 0; c < 5; c++) for (let d = 0; d < 2; d++) {
                let expected = 0n;
                for (let k = 0; k < 11; k++) expected += left[(a * 11 + k) * 4 + b] * right[(c * 11 + k) * 2 + d];
                expect(readArrayItem(result, at++)).toBe(expected);
            }
    });

    it('retains mixed real results and lazy errors', () => {
        const result = matmulValues(filledArray(2n, [11, 11]), filledArray(0.5, [11, 11]));
        if (!isRankArray(result)) throw Error('expected matrix');
        expect(readArrayItem(result, 0)).toBe(11);
        const source = derivedArray([11, 11], [], () => { throw Error('lazy failure'); });
        expect(() => readArrayItem(matmulValues(source, filledArray(1n, [11, 11])) as RankArray, 0))
            .toThrow('lazy failure');
    });

    it('checks cancellation while preparing dense integer operands', () => {
        const a = filledArray(1n, [65, 65]);
        expect(() => withDemandBudget(0, () => matmulValues(a, a))).toThrow(DemandBudgetExhausted);
    });
});
