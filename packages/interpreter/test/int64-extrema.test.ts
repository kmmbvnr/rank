import { describe, expect, it } from 'vitest';
import { typedArray, readArrayItem, ownedArray } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/jit/integer-array-kernel.js';
import { DemandBudgetExhausted, InterruptedError, withDemandBudget, withInterrupt } from '../src/interrupt.js';
import type { RankValue } from '../src/index.js';
const edges = [-(1n << 63n), -(1n << 53n) - 1n, -4294967296n, -2147483649n,
    -1n, 0n, 2147483648n, 4294967295n, 4294967296n, (1n << 53n) + 1n, (1n << 63n) - 1n];
for (const name of ['min', 'max']) describe(`Int64 ${name}`, () => {
    const choose = (a: bigint, b: bigint) => name === 'min' ? a < b ? a : b : a > b ? a : b;
    it('compares signed high words and unsigned low words exactly', () => {
        for (const right of edges) {
            const left = typedArray(BigInt64Array.from(edges));
            for (const reverse of [false, true]) {
                const result = mapStoredIntegers(reverse ? right : left, reverse ? left : right, name)!;
                expect(edges.map((_, i) => readArrayItem(result, i))).toEqual(edges.map(x => choose(x, right)));
            }
            const b = typedArray(BigInt64Array.from(edges, () => right));
            const result = mapStoredIntegers(left, b, name)!;
            expect(edges.map((_, i) => readArrayItem(result, i))).toEqual(edges.map(x => choose(x, right)));
        }
    });
    it('accepts mixed compact cells and leaves inputs unchanged', () => {
        const left = typedArray(BigInt64Array.from(edges));
        const right = typedArray(Int32Array.from(edges, (_, i) => i - 5));
        const result = mapStoredIntegers(left, right, name)!;
        expect(edges.map((_, i) => readArrayItem(result, i))).toEqual(edges.map((x, i) => choose(x, BigInt(i - 5))));
        expect(edges.map((_, i) => readArrayItem(left, i))).toEqual(edges);
    });
    it('retains arbitrary precision outside Int64', () => {
        const values = [...edges, 1n << 100n, -(1n << 100n)];
        const result = mapStoredIntegers(ownedArray(values), 0n, name)!;
        expect(values.map((_, i) => readArrayItem(result, i))).toEqual(values.map(x => choose(x, 0n)));
    });
    it('observes cancellation and demand budgets', () => {
        const left: RankValue = typedArray(new BigInt64Array(8192).fill(1n << 60n));
        expect(() => withInterrupt(new Int32Array([1]), () => mapStoredIntegers(left, 0n, name))).toThrow(InterruptedError);
        expect(() => withDemandBudget(1, () => mapStoredIntegers(left, 0n, name))).toThrow(DemandBudgetExhausted);
    });
});
