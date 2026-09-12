import { describe, expect, it } from 'vitest';
import { createArraySnapshot, type RankValue } from '../src/index.js';
import { arrayRevision, materializedArrayItems, ownedArray } from '../src/array-storage.js';
import { isKnownFileFree, ResourceSummary } from '../src/resource-summary.js';

describe('tracked array storage', () => {
    it('records indexed and public JS writes', () => {
        const a = createArraySnapshot([1n, 2n]);
        const first = arrayRevision(a)!;
        a.items[0] = 3n;
        expect(arrayRevision(a)).toBeGreaterThan(first);
        const second = arrayRevision(a)!;
        Object.defineProperty(a.items, '1', { value: 4n });
        expect(arrayRevision(a)).toBeGreaterThan(second);
        expect(materializedArrayItems(a)).toEqual([3n, 4n]);
        expect(materializedArrayItems(a)).not.toBe(a.items);
    });
    it('keeps scalar proofs after unrelated resource insertions', () => {
        const a = ownedArray([1n, 2n], [2], true);
        const other = new ResourceSummary();
        other.invalidate();
        expect(isKnownFileFree(a)).toBe(true);
        a.items[1] = 8n;
        expect(isKnownFileFree(a)).toBe(true);
    });
    it('invalidates proofs held by parents on an unknown insertion', () => {
        const a = createArraySnapshot([1n]);
        const parent = new ResourceSummary();
        parent.include(a);
        expect(parent.fileFree).toBe(true);
        a.items[0] = { kind: 'array', shape: [1], items: [2n] };
        expect(isKnownFileFree(a)).toBe(false);
        expect(parent.fileFree).toBe(false);
        expect(arrayRevision(a)).toBeUndefined();
    });
    it('declines unknown replaced storage and invalidates parents', () => {
        const a = createArraySnapshot([1n]);
        const parent = new ResourceSummary();
        parent.include(a);
        (a as { items: RankValue[] }).items = [3n];
        expect(a.items).toEqual([3n]);
        expect(arrayRevision(a)).toBeUndefined();
        expect(materializedArrayItems(a)).toBeUndefined();
        expect(parent.fileFree).toBe(false);
    });
    it('does not treat accessor storage as a numeric proof', () => {
        const a = createArraySnapshot([1n]);
        let reads = 0;
        Object.defineProperty(a.items, '0', { get: () => { reads++; return 2n; } });
        expect(isKnownFileFree(a)).toBe(false);
        expect(arrayRevision(a)).toBeUndefined();
        expect(materializedArrayItems(a)).toBeUndefined();
        expect(reads).toBe(0);
    });
});
