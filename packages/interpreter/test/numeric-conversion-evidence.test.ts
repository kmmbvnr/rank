import { describe, expect, it } from 'vitest';
import { RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { ownedArray, typedArray, storedScalarKinds, readArrayItem } from '../src/array-storage.js';
import { arrayElementTypes } from '../src/array-element-types.js';
import { realArray } from '../src/numeric-conversions.js';
import { withDemandBudget } from '../src/interrupt.js';

describe('real conversion physical kinds', () => {
    it.each([2n, '2.5', NaN, -0, Infinity, -Infinity])('retains exact output evidence for %s', value => {
        const input = ownedArray(Array(2048).fill(value));
        const diagnostics = new RuntimeDiagnostics();
        const result = diagnostics.run(() => {
            const out = realArray(input)!;
            expect(arrayElementTypes(out, true)).toEqual([
                value === Infinity || value === -Infinity ? 'numeric-limit' : 'real',
            ]);
            return out;
        });
        expect(diagnostics.elementTypeScannedCells).toBe(0);
        expect(readArrayItem(result, 0)).toBe(Number(value));
        expect(readArrayItem(result, 2047)).toBe(Number(value));
        result.items[0] = Infinity;
        expect(storedScalarKinds(result, true)).toContain('numeric-limit');
        result.items.fill(NaN);
        expect(storedScalarKinds(result, true)).toEqual(['real']);
    });

    it('retains exact discovery for mixed outputs and empty shapes', () => {
        const mixed = realArray(typedArray(new Float64Array([NaN, Infinity])))!;
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => expect(arrayElementTypes(mixed, true)).toEqual(['numeric-limit', 'real']));
        expect(diagnostics.elementTypeScannedCells).toBe(2);
        const empty = realArray(typedArray(new Int32Array(0), [0, 3]))!;
        expect(empty.shape).toEqual([0, 3]);
        expect(arrayElementTypes(empty, true)).toEqual([]);
    });

    it.each(['bad', '1e999', 10n ** 400n, false])('preserves conversion failure for %s', value => {
        expect(() => realArray(ownedArray([value]))).toThrow();
    });

    it('never demands a host reader and retains budgeted validation', () => {
        let reads = 0;
        const host: RankArray = { kind: 'array', shape: [1], items: [], itemAt() { reads++; return 1n; } };
        expect(realArray(host)).toBeUndefined();
        expect(reads).toBe(0);
        const diagnostics = new RuntimeDiagnostics();
        withDemandBudget(100000, () => diagnostics.run(() => {
            const out = realArray(typedArray(new Int32Array(2048)))!;
            expect(arrayElementTypes(out, true)).toEqual(['real']);
        }));
        expect(diagnostics.elementTypeScannedCells).toBe(2048);
    });
});
