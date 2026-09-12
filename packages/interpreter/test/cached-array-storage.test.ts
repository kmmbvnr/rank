import { describe, expect, it } from 'vitest';
import { materializedArrayItems, createArraySnapshot } from '../src/array-storage.js';
import { roundValue } from '../src/modules/numbers.js';
import type { RankArray } from '../src/value.js';

describe('materialized lazy storage', () => {
    it('never probes unknown lazy readers', () => {
        const value: RankArray = { kind: 'array', shape: [1],
            get items(): never { throw new Error('forced'); },
            itemAt() { throw new Error('read'); } };
        expect(materializedArrayItems(value)).toBeUndefined();
    });

    it('preserves the private cache when public items are edited', () => {
        const input = createArraySnapshot([1.2, 2.8]);
        const rounded = roundValue(input, 0n) as RankArray;
        expect(materializedArrayItems(rounded)).toBeUndefined();
        rounded.itemAt!(0);
        expect(materializedArrayItems(rounded)).toBeUndefined();
        const exposed = rounded.items;
        exposed[0] = 999;
        expect(materializedArrayItems(rounded)).toEqual([1, 3]);
        expect(rounded.itemAt!(0)).toBe(1);
        expect(rounded.itemAt!(1)).toBe(3);
        input.items[1] = 999;
        expect(materializedArrayItems(rounded)).toBeUndefined();
        expect(rounded.itemAt!(1)).toBe(999);
    });
});
