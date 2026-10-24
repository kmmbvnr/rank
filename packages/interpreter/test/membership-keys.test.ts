import { describe, expect, it } from 'vitest';
import { membershipKeys, MembershipKeys } from '../src/membership-keys.js';

describe('segmented membership keys', () => {
    it('uses native keys only when the known input count fits a block', () => {
        for (const size of [0, 1, 2 ** 23]) expect(membershipKeys(size)).toBeInstanceOf(Set);
        for (const size of [undefined, 2 ** 23 + 1, 50000000]) expect(membershipKeys(size)).toBeInstanceOf(MembershipKeys);
    });

    it('finds keys across full blocks, including duplicate and arbitrary precision keys', () => {
        const keys = new MembershipKeys<bigint>(2);
        const wide = 2n ** 100n;
        for (const value of [0n, -1n, -1n, wide, 0n, 7n, wide, 8n]) keys.add(value);
        for (const value of [0n, -1n, wide, 7n, 8n]) expect(keys.has(value)).toBe(true);
        for (const value of [1n, -wide, wide + 1n]) expect(keys.has(value)).toBe(false);
    });

    it('clears every block before indexing another frame', () => {
        const keys = new MembershipKeys<number>(2);
        for (const value of [1, 2, 3, 4, 5]) keys.add(value);
        keys.clear();
        for (const value of [1, 2, 3, 4, 5]) expect(keys.has(value)).toBe(false);
        for (const value of [6, 7, 8]) keys.add(value);
        for (const value of [6, 7, 8]) expect(keys.has(value)).toBe(true);
        expect(keys.has(5)).toBe(false);
        keys.clear();
        keys.clear();
        expect(keys.has(8)).toBe(false);
        keys.add(9);
        expect(keys.has(9)).toBe(true);
    });

    it('preserves Set key identity across blocks', () => {
        const keys = new MembershipKeys<string | number | bigint | boolean>(2);
        for (const value of [0n, 0, '0', false, Infinity, -Infinity, NaN]) keys.add(value);
        for (const value of [0n, -0, '0', false, Infinity, -Infinity, NaN]) expect(keys.has(value)).toBe(true);
        for (const value of [1n, 1, '1', true]) expect(keys.has(value)).toBe(false);
    });
});
