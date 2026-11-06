import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { denseScalarItems, readArrayItem, typedArray } from '../src/array-storage.js';
import { copyArrayStorage } from '../src/array-copy.js';
import { withInterrupt, withDemandBudget, InterruptedError, DemandBudgetExhausted } from '../src/interrupt.js';
import { shiftValue } from '../src/sequence.js';

describe.each([false, true])('typed shift (compilation=%s)', compilation => {
    it('reads neighbors without unpacking and preserves deferred-plan mutation protection', () => {
        const r = new Interpreter(() => {}, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            const cells = BigInt64Array.from({ length: 10000 }, (_, i) => BigInt(i));
            r.variables.set('A', typedArray(cells));
            diagnostics.run(() => r.execute("use sequences\nS' = A shift 1 with -1\nTotal = S sum"));
            expect(r.variables.get('Total')).toBe(49985000n);
            expect(diagnostics.typedUnpacks).toBe(0);
            expect(denseScalarItems(r.variables.get('A') as RankArray)).toBe(cells);
            expect(() => r.execute('A 0 = 99')).toThrow('read-only');
            expect(r.execute('S 1')).toBe(0n);
        } finally { r.dispose(); }
    });
});

it.each([0, 1, 2])('shifts a 3D array on axis %i with positive, negative and oversized amounts', axis => {
    const shape = [2, 3, 4];
    const source = typedArray(BigInt64Array.from({ length: 24 }, (_, i) => BigInt(i)), shape);
    for (const amount of [-10, -1, 0, 1, 10]) {
        const shifted = shiftValue(source, BigInt(amount), -1n, axis) as RankArray;
        const expected: bigint[] = [];
        for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 4; k++) {
            const coordinates = [i, j, k];
            coordinates[axis] -= amount;
            expected.push(coordinates[axis] < 0 || coordinates[axis] >= shape[axis] ? -1n
                : BigInt((coordinates[0] * 3 + coordinates[1]) * 4 + coordinates[2]));
        }
        expect(Array.from({ length: 24 }, (_, i) => readArrayItem(shifted, i))).toEqual(expected);
    }
});

// Force the block copier, rather than only checking the lazy shift reader.
it.each([0, 1, 2])('copies nonzero padding on axis %i without unpacking', axis => {
    const shape = [2, 3, 4];
    for (const storage of [Int32Array.from({ length: 24 }, (_, i) => i),
        BigInt64Array.from({ length: 24 }, (_, i) => BigInt(i) + (1n << 60n)),
        Float64Array.from({ length: 24 }, (_, i) => i + 0.5)]) {
        const source = typedArray(storage, shape);
        const fill = storage instanceof Float64Array ? -0 : 3000000000n;
        for (const amount of [-10, -1, 0, 1, 10]) {
            const shifted = shiftValue(source, BigInt(amount), fill, axis) as RankArray;
            const diagnostics = new RuntimeDiagnostics();
            const copy = diagnostics.run(() => copyArrayStorage(shifted));
            expect(copy).toBeDefined();
            expect(copy!.shape).toEqual(shape);
            for (let i = 0; i < 24; i++) expect(readArrayItem(copy!, i)).toBe(readArrayItem(shifted, i));
            expect(diagnostics.typedUnpacks).toBe(0);
            for (let i = 0; i < 24; i++) expect(readArrayItem(source, i)).toBe(
                storage instanceof Float64Array ? storage[i] : BigInt(storage[i]));
        }
    }
});
it('keeps nonfinite real padding and arbitrary precision fallback', () => {
    for (const fill of [NaN, Infinity, -Infinity, -0]) {
        const shifted = shiftValue(typedArray(new Float64Array([1.5, 2.5, 3.5])), 1n, fill) as RankArray;
        const copy = copyArrayStorage(shifted)!;
        expect(readArrayItem(copy, 0)).toBe(fill);
        expect(readArrayItem(copy, 1)).toBe(1.5);
    }
    const shifted = shiftValue(typedArray(new Int32Array([1, 2, 3])), 1n, 1n << 100n) as RankArray;
    expect(copyArrayStorage(shifted)).toBeUndefined();
    expect(readArrayItem(shifted, 0)).toBe(1n << 100n);
    expect(readArrayItem(shifted, 1)).toBe(1n);
});
it('polls while completing nonzero shift padding', () => {
    const source = typedArray(new BigInt64Array(131072));
    const shifted = shiftValue(source, 70000n, -1n) as RankArray;
    expect(() => withInterrupt(new Int32Array([1]), () => copyArrayStorage(shifted))).toThrow(InterruptedError);
    expect(() => withDemandBudget(1, () => copyArrayStorage(shifted))).toThrow(DemandBudgetExhausted);
    expect(readArrayItem(source, 0)).toBe(0n);
});
it('keeps opaque sources lazy, including all-fill shifts', () => {
    const reads: number[] = [];
    const source: RankArray = { kind: 'array', shape: [4], items: [],
        itemAt: i => { reads.push(i); return BigInt(i); } };
    const shifted = shiftValue(source, 1n, -1n) as RankArray;
    expect(copyArrayStorage(shifted)).toBeUndefined();
    expect(reads).toEqual([]);
    expect(readArrayItem(shifted, 0)).toBe(-1n);
    expect(reads).toEqual([]);
    expect(readArrayItem(shifted, 1)).toBe(0n);
    expect(reads).toEqual([0]);
    reads.length = 0;
    const allFill = shiftValue(source, 10n, -1n) as RankArray;
    expect(readArrayItem(allFill, 3)).toBe(-1n);
    expect(reads).toEqual([]);
});
