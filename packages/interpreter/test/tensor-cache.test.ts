import { describe, expect, it } from 'vitest';
import { mapBroadcastArrays } from '../src/tensor.js';
import { createArraySnapshot } from '../src/array-storage.js';
import type { RankValue } from '../src/index.js';
import { materializeValue } from '../src/materialize.js';

describe('broadcast recomputation and retained values', () => {
    it.each([[0n, 0n, 7n], [false, false, true]])('recomputes falsy cells and explicitly retains completed values: %s', (...initial) => {
        const source = createArraySnapshot(initial);
        const seen: RankValue[] = [];
        const result = mapBroadcastArrays(source, source, a => { seen.push(a); return a; });
        expect(result.itemAt!(1)).toBe(initial[1]);
        expect(result.itemAt!(0)).toBe(initial[0]);
        expect(result.itemAt!(2)).toBe(initial[2]);
        expect(result.itemAt!(-0)).toBe(initial[0]);
        expect(seen).toEqual([initial[1], initial[0], initial[2], initial[0]]);
        const retained = materializeValue(result);
        if (typeof retained !== 'object' || retained.kind !== 'array') throw new Error('expected completed array');
        expect(retained.items).toEqual(initial);
        expect(retained.itemAt?.(0) ?? retained.items[0]).toBe(initial[0]);
        expect(seen).toHaveLength(7);
        source.items[0] = initial[2];
        expect(result.items).toEqual([initial[2], initial[1], initial[2]]);
        expect(retained.items).toEqual(initial);
        expect(result.itemAt!(0)).toBe(initial[2]);
        expect(seen).toHaveLength(11);
    });

    it.each([2, 3])('repeats reads after failures and retains only explicit completion at size %i', size => {
        const source = createArraySnapshot([1n, 2n, 3n].slice(0, size));
        let attempts = 0;
        const result = mapBroadcastArrays(source, source, () => {
            attempts++;
            if (attempts === 1) throw new Error('first read');
            return BigInt(attempts);
        });
        expect(() => result.itemAt!(0)).toThrow('first read');
        expect(result.itemAt!(0)).toBe(2n);
        expect(result.itemAt!(-0)).toBe(3n);
        expect(result.itemAt!(1)).toBe(4n);
        expect(result.itemAt!(1)).toBe(5n);
        expect(attempts).toBe(5);
        const retained = materializeValue(result);
        if (typeof retained !== 'object' || retained.kind !== 'array') throw new Error('expected completed array');
        const expected = Array.from({ length: size }, (_, index) => BigInt(index + 6));
        expect(retained.items).toEqual(expected);
        expect(retained.items).toEqual(expected);
        expect(attempts).toBe(5 + size);
    });
});
