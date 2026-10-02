import { describe, expect, it } from 'vitest';
import { mapBroadcastArrays } from '../src/tensor.js';
import { createArraySnapshot } from '../src/array-storage.js';
import type { RankValue } from '../src/index.js';

describe('broadcast result caches', () => {
    it.each([[0n, 0n, 7n], [false, false, true]])('caches falsy cells independently of access order: %s', (...initial) => {
        const source = createArraySnapshot(initial);
        const seen: RankValue[] = [];
        const result = mapBroadcastArrays(source, source, a => { seen.push(a); return a; });
        expect(result.itemAt!(1)).toBe(initial[1]);
        expect(result.itemAt!(0)).toBe(initial[0]);
        expect(result.itemAt!(2)).toBe(initial[2]);
        expect(result.itemAt!(-0)).toBe(initial[0]);
        expect(seen).toEqual([initial[1], initial[0], initial[2]]);
        source.items[0] = initial[2];
        expect(result.items).toEqual([initial[2], initial[1], initial[2]]);
        result.items[0] = initial[0];
        expect(result.itemAt!(0)).toBe(initial[2]);
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
