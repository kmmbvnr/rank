import { describe, expect, it } from 'vitest';
import { mapBroadcastArrays } from '../src/tensor.js';
import { createArraySnapshot } from '../src/array-storage.js';
import type { RankValue } from '../src/index.js';

describe('broadcast result caches', () => {
    it.each([2, 3])('caches zero, false and later entries independently of access order at size %i', size => {
        const source = createArraySnapshot([0n, false, 7n].slice(0, size));
        const seen: RankValue[] = [];
        const result = mapBroadcastArrays(source, source, a => { seen.push(a); return a; });
        expect(result.itemAt!(1)).toBe(false);
        expect(result.itemAt!(0)).toBe(0n);
        if (size === 3) expect(result.itemAt!(2)).toBe(7n);
        source.items[0] = 20n;
        source.items[1] = true;
        if (size === 3) source.items[2] = 70n;
        expect(result.items).toEqual([20n, true, 70n].slice(0, size));
        expect(result.itemAt!(-0)).toBe(20n);
        expect(seen).toEqual([...([false, 0n, 7n].slice(0, size)), ...([20n, true, 70n].slice(0, size))]);
        result.items[0] = 100n;
        expect(result.itemAt!(0)).toBe(20n);
        expect(result.items[0]).toBe(100n);
    });

    it.each([2, 3])('does not cache failures and retains Map key behavior at size %i', size => {
        const source = createArraySnapshot([1n, 2n, 3n].slice(0, size));
        let attempts = 0;
        const result = mapBroadcastArrays(source, source, () => {
            attempts++;
            if (attempts === 1) throw new Error('first read');
            return BigInt(attempts);
        });
        expect(() => result.itemAt!(0)).toThrow('first read');
        expect(result.itemAt!(0)).toBe(2n);
        expect(result.itemAt!(-0)).toBe(2n);
        expect(result.itemAt!(1)).toBe(3n);
        expect(result.itemAt!(NaN)).toBe(4n);
        expect(result.itemAt!(NaN)).toBe(4n);
        expect(result.itemAt!(2 ** 32)).toBe(5n);
        expect(result.itemAt!(2 ** 32)).toBe(5n);
        expect(attempts).toBe(5);
    });
});
