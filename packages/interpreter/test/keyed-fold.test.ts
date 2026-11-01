import { describe, expect, it } from 'vitest';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { keyedFold } from '../src/keyed-fold.js';
import type { RankArray, RankValue } from '../src/value.js';

const array = (items: number[], shape = [items.length]) => ownedArray(items.map(BigInt), shape);
const items = (value: RankArray) => Array.from(
    { length: value.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(value, i));
const add = (a: RankValue, b: RankValue) => (a as bigint) + (b as bigint);

describe('keyed fold core', () => {
    it('reduces groups and scans at original positions', () => {
        const values = array([10, 20, 30, 40], [2, 2]);
        const keys = array([0, 1, 0, 1], [2, 2]);
        expect(items(keyedFold(values, keys, add))).toEqual([40n, 60n]);
        const result = keyedFold(values, keys, add, { scan: true, seed: 100n });
        expect(result.shape).toEqual([2, 2]);
        expect(items(result)).toEqual([110n, 120n, 140n, 160n]);
        expect(items(values)).toEqual([10n, 20n, 30n, 40n]);
    });
    it('preserves order for arbitrary reducers', () => {
        const subtract = (a: RankValue, b: RankValue) => (a as bigint) - (b as bigint);
        expect(items(keyedFold(array([10, 20, 3, 4, 2]), array([1, 0, 1, 0, 1]), subtract)))
            .toEqual([16n, 5n]);
    });
    it('fills missing groups and handles empty inputs', () => {
        const values = array([10, 20, 30]);
        const keys = array([2, 5, 2]);
        expect(items(keyedFold(values, keys, add, { identity: () => 0n })))
            .toEqual([0n, 0n, 40n, 0n, 0n, 20n]);
        expect(() => keyedFold(values, keys, add)).toThrow(/initial value/);
        expect(items(keyedFold(values, keys, add, { seed: 9n })))
            .toEqual([9n, 9n, 49n, 9n, 9n, 29n]);
        expect(items(keyedFold(array([]), array([]), add, { seed: 9n })))
            .toEqual([]);
        expect(items(keyedFold(array([]), array([]), add))).toEqual([]);
    });
    it('rejects invalid shapes and keys', () => {
        expect(() => keyedFold(array([1, 2]), array([0]), add)).toThrow(/shape/);
        expect(() => keyedFold(array([1]), array([-1]), add)).toThrow(/keys/);
        expect(() => keyedFold(array([1]), ownedArray([1.5]), add)).toThrow(/keys/);
    });
});
