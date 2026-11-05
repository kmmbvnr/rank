import { describe, expect, it } from 'vitest';
import { matmulValues } from '../src/modules/linalg.js';
import { ownedArray, typedArray, readArrayItem } from '../src/array-storage.js';
import { permutedArray } from '../src/array-permutation.js';
import { isRankArray } from '../src/value.js';
import { withDemandBudget, withInterrupt, DemandBudgetExhausted, InterruptedError, type InterruptSignal } from '../src/interrupt.js';

function cells(value: ReturnType<typeof matmulValues>) {
    if (!isRankArray(value)) throw Error('expected matrix');
    return Array.from({ length: value.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(value, i));
}
describe('contiguous stored matrix products', () => {
    it.each([[13, 19, 17], [7, 31, 4], [5, 32, 5], [4, 64, 7], [2, 257, 9], [3, 17, 32], [1, 257, 5], [4, 257, 3]])(
        'matches scalar integer and real oracles for %s x %s x %s', (rows, inner, columns) => {
            for (const real of [false, true]) {
                const a = Array.from({ length: rows * inner }, (_, i) => real ? (i % 17 - 8) / 7 : BigInt(i % 17 - 8) * 1000003n);
                const b = Array.from({ length: inner * columns }, (_, i) => real ? (i % 13 - 6) / 11 : BigInt(i % 13 - 6) * 32767n);
                const left = real ? typedArray(Float64Array.from(a, Number), [rows, inner]) : ownedArray(a, [rows, inner]);
                const right = real ? typedArray(Float64Array.from(b, Number), [inner, columns]) : ownedArray(b, [inner, columns]);
                const actual = cells(matmulValues(left, right));
                for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
                    let expected = real ? 0 : 0n;
                    for (let k = 0; k < inner; k++) expected = real
                        ? Number(expected) + Number(a[i * inner + k]) * Number(b[k * columns + j])
                        : expected as bigint + (a[i * inner + k] as bigint) * (b[k * columns + j] as bigint);
                    expect(actual[i * columns + j]).toBe(expected);
                }
            }
        });
    it('contracts stored permutations without changing layout semantics', () => {
        const a = typedArray(Int32Array.from({ length: 19 * 13 }, (_, i) => i % 17 - 8), [19, 13]);
        const b = typedArray(Int32Array.from({ length: 17 * 19 }, (_, i) => i % 11 - 5), [17, 19]);
        const left = permutedArray(a, [1, 0]), right = permutedArray(b, [1, 0]);
        const actual = cells(matmulValues(left, right));
        for (let i = 0; i < 13; i++) for (let j = 0; j < 17; j++) {
            let expected = 0n;
            for (let k = 0; k < 19; k++) expected += (readArrayItem(a, k * 13 + i) as bigint) * (readArrayItem(b, j * 19 + k) as bigint);
            expect(actual[i * 17 + j]).toBe(expected);
        }
    });
    it.each([[1e20, 1, -1e20, -0], [Infinity], [-Infinity], [NaN], [-0]])('retains real accumulation order and edge values: %s', (...prefix) => {
        const row = [...prefix, ...Array<number>(257 - prefix.length).fill(0)];
        const left = typedArray(Float64Array.from([...row, ...row]), [2, 257]);
        const rightValues = Array.from({ length: 257 * 7 }, (_, i) => i % 7 === 0 ? -0 : i % 7);
        const right = typedArray(Float64Array.from(rightValues), [257, 7]);
        const actual = cells(matmulValues(left, right));
        for (let j = 0; j < 7; j++) {
            let expected = 0;
            for (let k = 0; k < 257; k++) expected += row[k] * rightValues[k * 7 + j];
            expect(actual[j]).toBe(expected);
            expect(actual[7 + j]).toBe(expected);
        }
    });
    it('keeps the exact demand cost of the ordinary real kernel', () => {
        const left = typedArray(new Float64Array(4 * 256).fill(2), [4, 256]);
        const right = typedArray(new Float64Array(256 * 257).fill(3), [256, 257]);
        expect(() => withDemandBudget(1027, () => matmulValues(left, right))).toThrow(DemandBudgetExhausted);
        expect(cells(withDemandBudget(1028, () => matmulValues(left, right)))).toEqual(Array(1028).fill(1536));
    });
    it('retains callback polling at the ordinary output boundary', () => {
        const left = typedArray(new Float64Array(4 * 256).fill(2), [4, 256]);
        const right = typedArray(new Float64Array(256 * 257).fill(3), [256, 257]);
        let exchanges = 0;
        const signal: InterruptSignal = { length: 1, load: () => 0, store() {},
            exchange: () => { exchanges++; return 0; }, wait() {} };
        withInterrupt(signal, () => matmulValues(left, right));
        expect(exchanges).toBe(1);
    });
    it('checks atomic cancellation while preparing the private transpose', () => {
        const left = typedArray(new Float64Array(64 * 64).fill(1), [64, 64]);
        const signal = new Int32Array(new SharedArrayBuffer(12));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => matmulValues(left, left))).toThrow(InterruptedError);
    });
});
