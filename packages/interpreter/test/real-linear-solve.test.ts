import { describe, expect, it, vi } from 'vitest';
import { solveStoredReals } from '../src/runtime/real-linear-solve.js';
import { solveLinearSystem } from '../src/modules/linalg.js';
import { typedArray, ownedArray, derivedArray, readArrayItem } from '../src/array-storage.js';
import { withDemandBudget, withInterrupt, InterruptedError } from '../src/interrupt.js';
import type { RankArray } from '../src/value.js';
const matrix = (values: number[], shape: number[]) => typedArray(Float64Array.from(values), shape);
const cells = (a: RankArray) => Array.from({ length: a.shape.reduce((x, y) => x * y, 1) }, (_, i) => readArrayItem(a, i));

describe('flat finite real solve', () => {
    it('pivots, solves multiple right sides and keeps source snapshots', () => {
        const a = matrix([0, 2, 1, 3], [2, 2]), b = matrix([4, 8, 7, 14], [2, 2]);
        const result = solveStoredReals(a, b)!;
        expect(result).toBeDefined();
        expect(cells(result)).toEqual([1, 2, 2, 4]);
        expect(cells(a)).toEqual([0, 2, 1, 3]);
        expect(cells(b)).toEqual([4, 8, 7, 14]);
    });
    it('agrees with the observable scalar solver for deterministic dense systems', () => {
        for (const size of [...Array.from({ length: 12 }, (_, i) => i + 1), 80]) {
            const a = matrix(Array.from({ length: size * size }, (_, i) => i % (size + 1) === 0 ? size * 2 : (i * 17 % 11 - 5) / 8), [size, size]);
            const b = matrix(Array.from({ length: size }, (_, i) => i / 3 - 2), [size]);
            const expected = withDemandBudget(1000000, () => solveLinearSystem(a, b));
            expect(cells(solveStoredReals(a, b)!)).toEqual(cells(expected));
            expect(cells(withInterrupt(new Int32Array([0]), () => solveStoredReals(a, b))!)).toEqual(cells(expected));
        }
    });
    it('preserves overflow propagation and normalized zero', () => {
        for (const [coefficients, rhs] of [
            [[1, 1e308, 1e308, -1, 1e308, 1e308, 0, 0, 1], [1, 2, 3]],
            [[1, 0, 0, -1, 1, 1, 0, 0, 1], [1e308, 1e308, 1]],
        ]) {
            const a = matrix(coefficients, [3, 3]), b = matrix(rhs, [3]);
            expect(cells(solveStoredReals(a, b)!)).toEqual([NaN, NaN, NaN]);
            expect(cells(solveStoredReals(a, b)!)).toEqual(cells(withDemandBudget(10000, () => solveLinearSystem(a, b))));
        }
        expect(cells(solveStoredReals(matrix([1], [1, 1]), matrix([-0], [1]))!)).toEqual([0]);
    });
    it('keeps singular errors and refuses nonfinite, mixed, opaque and shared inputs', () => {
        expect(() => solveStoredReals(matrix([1, 2, 2, 4], [2, 2]), matrix([1, 2], [2]))).toThrow('nonsingular');
        const rhs = matrix([1], [1]);
        for (const a of [matrix([Infinity], [1, 1]), matrix([NaN], [1, 1]), ownedArray([1n], [1, 1]),
            derivedArray([1, 1], [], () => { throw Error('opaque read'); }),
            typedArray(new Float64Array(new SharedArrayBuffer(8)).fill(1), [1, 1])])
            expect(solveStoredReals(a, rhs)).toBeUndefined();
    });
    it('does not require optional weak scratch reuse', () => {
        const a = matrix([1], [1, 1]), b = matrix([2], [1]);
        vi.stubGlobal('WeakRef', undefined);
        try {
            expect(cells(solveStoredReals(a, b)!)).toEqual([2]);
            expect(cells(solveStoredReals(a, b)!)).toEqual([2]);
        } finally { vi.unstubAllGlobals(); }
    });
    it('retains cancellation and declines observable budgets', () => {
        const a = matrix([1], [1, 1]), b = matrix([2], [1]);
        expect(withDemandBudget(1000, () => solveStoredReals(a, b))).toBeUndefined();
        expect(() => withInterrupt(new Int32Array([1]), () => solveStoredReals(a, b))).toThrow(InterruptedError);
    });
});
