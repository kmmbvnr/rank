import { expect, it } from 'vitest';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { matmulValues } from '../src/modules/linalg.js';
import type { RankArray } from '../src/value.js';
import { InterruptedError, withInterrupt, withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';

it('combines zero, unit and signed weighted rows exactly beyond Int32', () => {
    const rows = 4, inner = 5, columns = 129;
    const left = [0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -2, 0, 0, 3, 0, 1, -1, 0, 0, 0];
    const right = Array.from({ length: inner * columns }, (_, i) => i % 3 ? 2147483647 - i : -2147483648 + i);
    const a = typedArray(Int32Array.from(left), [rows, inner]);
    const b = typedArray(Int32Array.from(right), [inner, columns]);
    const result = matmulValues(a, b) as RankArray;
    expect(result.shape).toEqual([rows, columns]);
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        let sum = 0n;
        for (let k = 0; k < inner; k++) sum += BigInt(left[row * inner + k]) * BigInt(right[k * columns + column]);
        expect(readArrayItem(result, row * columns + column)).toBe(sum);
    }
    expect(Array.from({ length: left.length }, (_, i) => readArrayItem(a, i))).toEqual(left.map(BigInt));
    expect(Array.from({ length: right.length }, (_, i) => readArrayItem(b, i))).toEqual(right.map(BigInt));
});
it('stores every low-word carry and signed safe-integer boundary exactly', () => {
    const edge = [-9007199254740991n, -4294967297n, -4294967296n, -2147483649n,
        -1n, 0n, 2147483648n, 4294967295n, 4294967296n, 9007199254740991n];
    const values = Array.from({ length: 1024 }, (_, i) => edge[i % edge.length]);
    const left = typedArray(new Int32Array([1, -1]), [2, 1]);
    const right = typedArray(BigInt64Array.from(values), [1, values.length]);
    const result = matmulValues(left, right) as RankArray;
    expect(Array.from({ length: values.length * 2 }, (_, i) => readArrayItem(result, i)))
        .toEqual([...values, ...values.map(x => -x)]);
});
it('retains exact fallback when large products cancel', () => {
    const right = typedArray(new BigInt64Array(256).fill(1n << 60n), [2, 128]);
    const left = typedArray(new Int32Array([1, -1, 0, 0]), [2, 2]);
    const result = matmulValues(left, right) as RankArray;
    for (let i = 0; i < 256; i++) expect(readArrayItem(result, i)).toBe(0n);
});
it('keeps cancellation and observable demand budgets', () => {
    const left = typedArray(new Int32Array([1, 0, 0, 0]), [2, 2]);
    const right = typedArray(new Int32Array(16384).fill(9), [2, 8192]);
    expect(() => withInterrupt(new Int32Array([1]), () => matmulValues(left, right))).toThrow(InterruptedError);
    expect(() => withDemandBudget(1, () => matmulValues(left, right))).toThrow(DemandBudgetExhausted);
});
