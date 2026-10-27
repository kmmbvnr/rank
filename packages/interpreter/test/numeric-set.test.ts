import { describe, expect, it, vi } from 'vitest';
import { addToCollection, newStructure, removeFromCollection, setHas } from '../src/collections.js';
import { clonePreviewValue } from '../src/preview-values.js';
import { setValueKey } from '../src/set.js';
import type { RankSet, RankValue } from '../src/value.js';

const set = () => newStructure('set') as RankSet;

describe('exact numeric set keys', () => {
    it.each([
        [0n, -0], [-7n, -7], [9007199254740992n, 9007199254740992],
        [1n << 100n, Number(1n << 100n)],
    ])('shares an integer and integral real key: %s', (integer, real) => {
        for (const [stored, query] of [[integer, real], [real, integer]]) {
            const target = set();
            addToCollection(target, stored);
            expect(setHas(target, query)).toBe(true);
            removeFromCollection(target, query);
            expect(target.entries.size).toBe(0);
        }
    });

    it('keeps adjacent wide integers distinct, ordered and duplicate-free', () => {
        const target = set();
        const values = [9007199254740993n, 9007199254740992n, -(1n << 100n), 1n << 100n];
        for (const value of [...values, ...values]) addToCollection(target, value);
        expect([...target.entries.values()]).toEqual(values);
        expect(setHas(target, 9007199254740994n)).toBe(false);
        expect(setHas(target, -(1n << 100n) + 1n)).toBe(false);
        for (const value of values) expect(setHas(target, value)).toBe(true);
    });

    it.each<RankValue>([0.5, Infinity, -Infinity, NaN, 'number:1', true])('preserves noninteger keys: %s', value => {
        const target = set();
        addToCollection(target, value);
        expect(target.entries.has(setValueKey(value))).toBe(true);
        expect(setHas(target, value)).toBe(true);
        expect(setHas(target, 1n)).toBe(false);
        removeFromCollection(target, value);
        expect(setHas(target, value)).toBe(false);
    });

    it('keeps legacy string keys and observable dispatch for foreign maps', () => {
        const entries = new Map([[setValueKey(3n), 3n]]);
        const target: RankSet = { kind: 'set', entries };
        const has = vi.spyOn(entries, 'has');
        expect(setHas(target, 3n)).toBe(true);
        expect(has).toHaveBeenCalledWith('number:3');
        addToCollection(target, 4n);
        expect(entries.get('number:4')).toBe(4n);
        removeFromCollection(target, 3n);
        expect([...entries]).toEqual([['number:4', 4n]]);
    });

    it('follows a host replacement of an owned set map', () => {
        const target = set();
        addToCollection(target, 3n);
        const entries = new Map([['number:9', 9n]]);
        Object.defineProperty(target, 'entries', { value: entries });
        expect(setHas(target, 3n)).toBe(false);
        expect(setHas(target, 9n)).toBe(true);
        addToCollection(target, 10n);
        expect(entries.get('number:10')).toBe(10n);
    });

    it('preserves numeric keys in detached previews without sharing mutations', () => {
        const target = set();
        addToCollection(target, 9007199254740993n);
        const preview = clonePreviewValue(target) as RankSet;
        expect(setHas(preview, 9007199254740993n)).toBe(true);
        removeFromCollection(preview, 9007199254740993n);
        expect(setHas(target, 9007199254740993n)).toBe(true);
        addToCollection(preview, 2n);
        expect(setHas(preview, 2n)).toBe(true);
        expect(setHas(target, 2n)).toBe(false);
    });
});
