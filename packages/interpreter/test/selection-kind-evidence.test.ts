import { describe, expect, it } from 'vitest';
import { RuntimeDiagnostics, type RankArray } from '../src/index.js';
import { typedArray, storedScalarKinds, knownStoredScalarKind, readArrayItem } from '../src/array-storage.js';
import { arrayElementTypes } from '../src/array-element-types.js';
import { atArray, sliceArray } from '../src/selectors.js';
import { withDemandBudget } from '../src/interrupt.js';

const gather = (source: RankArray, offsets: number[]) => sliceArray(source, {
    shape: [offsets.length], offsetAt: i => offsets[i],
}) as RankArray;

describe('selection physical kind evidence', () => {
    it.each([1.5, NaN, Infinity, -Infinity])('copies known uniform kinds through rows and gathers: %s', cell => {
        const kind = cell === Infinity || cell === -Infinity ? 'numeric-limit' : 'real';
        const source = typedArray(new Float64Array(6).fill(cell), [2, 3], undefined, kind);
        const diagnostics = new RuntimeDiagnostics();
        const selected = diagnostics.run(() => {
            const row = atArray(source, [1n]) as RankArray;
            const out = gather(source, [5, 1, 5, 0]);
            expect(row.shape).toEqual([3]);
            expect(arrayElementTypes(row, true)).toEqual([kind]);
            expect(arrayElementTypes(out, true)).toEqual([kind]);
            expect(readArrayItem(row, 2)).toBe(cell);
            expect(readArrayItem(out, 0)).toBe(cell);
            return out;
        });
        expect(diagnostics.elementTypeScannedCells).toBe(0);
        source.items[5] = 9.5;
        expect(readArrayItem(selected, 0)).toBe(cell);
        selected.items[0] = true;
        expect(arrayElementTypes(selected, true)).toContain('boolean');
    });

    it('never scans a larger unknown source to prove a tiny output', () => {
        const source = typedArray(new Float64Array(65536).fill(1.5));
        const diagnostics = new RuntimeDiagnostics();
        const out = diagnostics.run(() => gather(source, [3, 1, 5]));
        expect(diagnostics.elementTypeScannedCells).toBe(0);
        expect(knownStoredScalarKind(source)).toBeUndefined();
        diagnostics.run(() => expect(arrayElementTypes(out, true)).toEqual(['real']));
        expect(diagnostics.elementTypeScannedCells).toBe(3);
    });

    it('does not copy mixed source kinds onto a uniform subset', () => {
        const source = typedArray(new Float64Array([Infinity, 2, 3, 4]));
        expect(storedScalarKinds(source, true)).toEqual(['numeric-limit', 'real']);
        const out = gather(source, [3, 1, 2]);
        expect(arrayElementTypes(out, true)).toEqual(['real']);
        source.items[1] = -Infinity;
        expect(knownStoredScalarKind(source)).toBeUndefined();
        expect(gather(source, [1, 0]).items).toEqual([-Infinity, Infinity]);
    });

    it('retains validation under an observable budget', () => {
        const source = typedArray(new Float64Array(6).fill(1.5), [2, 3], undefined, 'real');
        const diagnostics = new RuntimeDiagnostics();
        withDemandBudget(100000, () => diagnostics.run(() => {
            expect(arrayElementTypes(gather(source, [5, 0]), true)).toEqual(['real']);
            expect(arrayElementTypes(atArray(source, [1n]) as RankArray, true)).toEqual(['real']);
        }));
        expect(diagnostics.elementTypeScannedCells).toBe(5);
    });

    it('offers known-only evidence without forcing discovery or host readers', () => {
        const source = typedArray(new Float64Array([NaN, Infinity]));
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => expect(knownStoredScalarKind(source)).toBeUndefined());
        expect(diagnostics.elementTypeScannedCells).toBe(0);
        expect(storedScalarKinds(source, true)).toEqual(['numeric-limit', 'real']);
        expect(knownStoredScalarKind(source)).toBeUndefined();
        let reads = 0;
        const host: RankArray = { kind: 'array', shape: [1], items: [], itemAt() { reads++; return 1.5; } };
        expect(knownStoredScalarKind(host)).toBeUndefined();
        expect(reads).toBe(0);
    });
});
