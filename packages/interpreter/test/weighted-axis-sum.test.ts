import { native } from '../src/modules/shared.js';
import { describe, it, expect } from 'vitest';
import { Interpreter, isRankArray, type RankValue } from '../src/index.js';
import { typedArray, derivedArray, integer32Cells, readArrayItem } from '../src/array-storage.js';
import { permutedArray } from '../src/array-permutation.js';
import { weightedAxisSum } from '../src/jit/weighted-axis-sum.js';
import { withInterrupt, withDemandBudget, InterruptedError } from '../src/interrupt.js';
const values = Int32Array.from({ length: 4096 }, (_, i) => (i * 31 % 127) - 63);
const coefficients = [9007199254740993n, -9007199254740991n, 4294967295n, -4294967297n];
const oracle = (weights: bigint[]) => Array.from({ length: 1024 }, (_, i) => weights.reduce((sum, x, k) => sum + x * BigInt(values[i * 4 + k]), 0n));
const cells = (value: RankValue | undefined) => {
    if (!value || !isRankArray(value)) throw Error('expected vector');
    return Array.from({ length: value.shape[0] }, (_, i) => readArrayItem(value, i));
};
describe('weighted integer axis sums', () => {
    it.each([0, 1])('preserves signed words and transposed strides, axis %s', axis => {
        const source = typedArray(values, [1024, 4]);
        const matrix = axis === 0 ? permutedArray(source, [1, 0]) : source;
        const weights = typedArray(BigInt64Array.from(coefficients), axis === 0 ? [4, 1] : [1, 4]);
        expect(cells(weightedAxisSum(matrix, weights, axis))).toEqual(oracle(coefficients));
        expect(cells(weightedAxisSum(weights, matrix, axis))).toEqual(oracle(coefficients));
    });
    it('contracts a physically transposed matrix and rejects wide count words', () => {
        const transposed = Int32Array.from({ length: values.length }, (_, i) => values[i % 1024 * 4 + Math.floor(i / 1024)]);
        const weights = typedArray(BigInt64Array.from(coefficients), [4, 1]);
        expect(cells(weightedAxisSum(typedArray(transposed, [4, 1024]), weights, 0))).toEqual(oracle(coefficients));
        expect(weightedAxisSum(typedArray(new BigInt64Array(4096).fill(4294967297n), [4, 1024]), weights, 0)).toBeUndefined();
    });
    it('accepts small counts in wide storage', () => {
        expect(cells(weightedAxisSum(typedArray(BigInt64Array.from(values, BigInt), [1024, 4]),
            typedArray(BigInt64Array.from(coefficients), [1, 4]), 1))).toEqual(oracle(coefficients));
    });
    it('keeps bounded sums compact and validates zero-matrix coefficients', () => {
        const weights = typedArray(new Int32Array([1, -1, 1, -1]), [1, 4]);
        const result = weightedAxisSum(typedArray(values, [1024, 4]), weights, 1);
        if (!result || !isRankArray(result)) throw Error('expected vector');
        expect(integer32Cells(result)).toBeDefined();
        expect(cells(result)).toEqual(oracle([1n, -1n, 1n, -1n]));
        expect(cells(weightedAxisSum(typedArray(new Int32Array(4096), [1024, 4]), weights, 1))).toEqual(Array(1024).fill(0n));
    });
    it('handles compact weights and low-word carries', () => {
        const weights = [-2147483648n, 2147483647n, -1n, 0n];
        expect(cells(weightedAxisSum(typedArray(values, [1024, 4]), typedArray(Int32Array.from(weights, Number), [1, 4]), 1))).toEqual(oracle(weights));
    });
    it('declines unsafe bounds, opaque readers, reals and incompatible shapes', () => {
        const matrix = typedArray(values, [1024, 4]);
        for (const weights of [typedArray(new BigInt64Array(4).fill(2n ** 62n), [1, 4]),
            typedArray(new Float64Array(4).fill(1), [1, 4]), derivedArray([1, 4], [], i => coefficients[i]),
            typedArray(new Int32Array(8), [2, 4])]) expect(weightedAxisSum(matrix, weights, 1)).toBeUndefined();
        expect(weightedAxisSum(typedArray(new Int32Array(4096).fill(1048577), [1024, 4]), typedArray(new Int32Array(4), [1, 4]), 1)).toBeUndefined();
    });
    it('retains cancellation and declines budgeted execution', () => {
        const matrix = typedArray(values, [1024, 4]), weights = typedArray(BigInt64Array.from(coefficients), [1, 4]);
        expect(() => withInterrupt(new Int32Array([1]), () => weightedAxisSum(matrix, weights, 1))).toThrow(InterruptedError);
        expect(withDemandBudget(1, () => weightedAxisSum(matrix, weights, 1))).toBeUndefined();
    });
    it.each([false, true])('evaluates operands once when the sum binding changes, compilation=%s', compilation => {
        const r = new Interpreter(() => {}, { compilation });
        let calls = 0;
        try {
            r.variables.set('Power', typedArray(BigInt64Array.from(coefficients), [1, 4]));
            r.variables.set('Fetch', native('Fetch', 1, () => {
                calls++;
                r.variables.set('sum', native('customSum', 1, () => 17n));
                return typedArray(values, [1024, 4]);
            }));
            expect(cells(r.execute('((0 Fetch) * Power) sum axis 1'))).toEqual(Array(1024).fill(17n));
            expect(calls).toBe(1);
        } finally { r.dispose(); }
    });
    it.each([false, true])('executes original syntax, compilation=%s', compilation => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.variables.set('Counts', typedArray(values, [1024, 4]));
            r.variables.set('Power', typedArray(BigInt64Array.from(coefficients), [4, 1]));
            expect(cells(r.execute('use sequences\n(Counts transpose * Power) sum axis 0'))).toEqual(oracle(coefficients));
            const wide = Array(4).fill(2n ** 62n);
            r.variables.set('Power', typedArray(BigInt64Array.from(wide), [4, 1]));
            expect(cells(r.execute('use sequences\n(Counts transpose * Power) sum axis 0'))).toEqual(oracle(wide));
        } finally { r.dispose(); }
    });
});
