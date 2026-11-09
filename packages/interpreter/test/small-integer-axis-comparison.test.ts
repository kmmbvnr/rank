import { describe, expect, it } from 'vitest';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { compareStoredInt32 } from '../src/integer-array-kernel.js';
import { withDemandBudget } from '../src/interrupt.js';
import type { RankArray } from '../src/index.js';
import { sliceArray } from '../src/selectors.js';
const comparisons = {
    equal: (a: bigint, b: bigint) => a === b,
    notequal: (a: bigint, b: bigint) => a !== b,
    less: (a: bigint, b: bigint) => a < b,
    greater: (a: bigint, b: bigint) => a > b,
    atmost: (a: bigint, b: bigint) => a <= b,
    atleast: (a: bigint, b: bigint) => a >= b,
};
describe.each([false, true])('small boxed integer axes (reverse=%s)', reverse => {
    it.each(Object.entries(comparisons))('broadcasts exact %s comparisons', (name, compare) => {
        const column = Array.from({ length: 50 }, (_, i) => BigInt(i - 25));
        const row = Int32Array.from({ length: 128 }, (_, i) => i - 64);
        const a = ownedArray(column, [50, 1]), b = typedArray(row, [1, 128]);
        const result = compareStoredInt32(reverse ? b : a, reverse ? a : b, name)!;
        expect(result).toBeDefined();
        expect(result.shape).toEqual([50, 128]);
        expect([...result.items]).toEqual(column.flatMap(x => [...row].map(y => reverse ? compare(BigInt(y), x) : compare(x, BigInt(y)))));
        expect([...a.items]).toEqual(column);
    });
});
it('narrows both small boxed axes once', () => {
    const a = ownedArray(Array.from({ length: 32 }, (_, i) => BigInt(i)), [32, 1]);
    const b = ownedArray(Array.from({ length: 32 }, (_, i) => BigInt(i)), [1, 32]);
    const result = compareStoredInt32(a, b, 'equal')!;
    expect(result.shape).toEqual([32, 32]);
    expect([...result.items].filter(Boolean)).toHaveLength(32);
});
it('keeps wide integers and real axes on their ordinary paths', () => {
    const row = typedArray(new Int32Array(128), [1, 128]);
    for (const special of [1n << 60n, 0.5]) {
        const cells = Array<bigint | number>(32).fill(typeof special === 'bigint' ? 0n : 0); cells[31] = special;
        expect(compareStoredInt32(ownedArray(cells, [32, 1]), row, 'greater')).toBeUndefined();
        expect(cells[31]).toBe(special);
    }
});
it('keeps observable demand on the ordinary path', () => {
    const a = ownedArray(Array<bigint>(32).fill(1n), [32, 1]);
    const b = typedArray(new Int32Array(128), [1, 128]);
    withDemandBudget(100, () => expect(compareStoredInt32(a, b, 'greater')).toBeUndefined());
});
it('does not inspect opaque row cells', () => {
    let calls = 0;
    const a: RankArray = { kind: 'array', shape: [32, 1], items: [], itemAt: () => { calls++; return 1n; } };
    const b = typedArray(new Int32Array(128), [1, 128]);
    expect(compareStoredInt32(a, b, 'greater')).toBeUndefined();
    expect(calls).toBe(0);
});

it('keeps the final partial bitmap word outside the result shape', () => {
    const a = ownedArray(Array.from({ length: 31 }, (_, i) => BigInt(i)), [31, 1]);
    const b = ownedArray(Array.from({ length: 35 }, (_, i) => BigInt(i)), [1, 35]);
    const result = compareStoredInt32(a, b, 'atleast')!;
    expect(result.shape).toEqual([31, 35]);
    expect([...result.items]).toHaveLength(1085);
    expect([...result.items].filter(Boolean)).toHaveLength(496);
});

it('keeps shared Int64 readers on their existing route', () => {
    const a = ownedArray(Array<bigint>(32).fill(1n), [32, 1]);
    const cells = new BigInt64Array(new SharedArrayBuffer(128 * 8)); cells.fill(1n << 40n);
    const b = typedArray(cells, [1, 128]);
    expect(compareStoredInt32(a, b, 'greater')).toBeUndefined();
});

it('narrows only the logical cells of a reversed boxed view', () => {
    const source = ownedArray(Array.from({ length: 63 }, (_, i) => BigInt(i)));
    const column = sliceArray(source, { shape: [31, 1], offsetAt: index => 62 - index,
        linear: { offset: 62, stride: -1 } });
    const row = typedArray(Int32Array.from({ length: 128 }, (_, i) => i), [1, 128]);
    const result = compareStoredInt32(column, row, 'greater')!;
    expect(result.shape).toEqual([31, 128]);
    expect([...result.items]).toEqual(Array.from({ length: 31 }, (_, i) =>
        Array.from({ length: 128 }, (_, j) => 62 - i > j)).flat());
});

it('does not inspect an opaque counterpart while preparing a boxed axis', () => {
    let reads = 0;
    const a = ownedArray(Array<bigint>(32).fill(1n), [32, 1]);
    const b: RankArray = { kind: 'array', get shape() { reads++; return [1, 128]; },
        items: [], itemAt: () => { reads++; return 0n; } };
    expect(compareStoredInt32(a, b, 'greater')).toBeUndefined();
    expect(reads).toBe(0);
});
