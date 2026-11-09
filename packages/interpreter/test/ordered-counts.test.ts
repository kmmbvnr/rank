import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type RankValue } from '../src/index.js';
import { ownedArray, typedArray, readArrayItem, derivedArray } from '../src/array-storage.js';
import { numericSortedCounts } from '../src/numeric-collections.js';
import { uniqueCounts } from '../src/modules/sequence-distinct.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';
function unpack(value: RankValue) {
    if (typeof value !== 'object' || value.kind !== 'tuple') throw Error('expected tuple');
    return value.items.map(array => {
        if (!isRankArray(array)) throw Error('expected array');
        return Array.from({ length: array.shape[0] }, (_, i) => readArrayItem(array, i));
    });
}
const oracle = (items: (bigint | number)[]) => {
    const keys: (bigint | number)[] = [], counts: bigint[] = [], positions = new Map<bigint | number, number>();
    for (const item of items) {
        const index = positions.get(item);
        if (index === undefined) { positions.set(item, keys.length); keys.push(item); counts.push(1n); }
        else counts[index]++;
    }
    return [keys, counts];
};
for (const descending of [false, true]) describe(`ordered counts descending=${descending}`, () => {
    it.each(['int32', 'int64', 'real'])('counts %s cells in first-occurrence order', kind => {
        const values = kind === 'int32' ? [-2147483648, -3, -3, 0, 0, 0, 2147483647]
            : kind === 'int64' ? [-(1n << 63n), -4294967297n, -4294967296n, -1n, 0n, 4294967295n, 4294967296n, 9007199254740992n, 9007199254740993n, 9007199254740993n, (1n << 63n) - 1n]
            : [-Infinity, -2.5, -0, 0, 0, .5, Infinity];
        if (descending) values.reverse();
        const array = kind === 'int32' ? typedArray(Int32Array.from(values as number[]))
            : kind === 'int64' ? typedArray(BigInt64Array.from(values as bigint[])) : typedArray(Float64Array.from(values as number[]));
        const expected = kind === 'int32' ? (values as number[]).map(BigInt) : values;
        const d = new RuntimeDiagnostics(), result = unpack(d.run(() => uniqueCounts(array)));
        expect(result).toEqual(oracle(expected));
        if (kind === 'real') expect(Object.is(result[0][2], descending ? 0 : -0)).toBe(true);
        expect(d.numericSortedCounts).toBe(1);
    });
    it('retains exact frequencies across the word sign and carry boundaries', () => {
        const keys = [-(1n << 63n), -(1n << 32n) - 1n, -(1n << 32n), -1n, 0n, (1n << 32n) - 1n, 1n << 32n, (1n << 63n) - 1n];
        const input = keys.flatMap((key, i) => Array(i + 1).fill(key) as bigint[]);
        if (descending) input.reverse();
        expect(unpack(numericSortedCounts(typedArray(BigInt64Array.from(input)))!)).toEqual(oracle(input));
    });
});
it.each([[1n, 3n, 2n, 1n], [3n, 1n, 2n, 3n], [1n << 80n, 1n << 80n, 1n], [NaN, 0, NaN], [false, false, true]].map(values => ({ values })))('retains fallback for $values', ({ values }) => {
    const input = ownedArray(values);
    expect(numericSortedCounts(input)).toBeUndefined();
    expect(unpack(uniqueCounts(input))).toEqual(oracle(values as (number | bigint)[]));
});
it('retains empty and singleton results', () => {
    expect(unpack(uniqueCounts(typedArray(new Int32Array(0))))).toEqual([[], []]);
    expect(unpack(uniqueCounts(typedArray(new BigInt64Array([9007199254740993n]))))).toEqual([[9007199254740993n], [1n]]);
});
it('does not read opaque cells while checking admission', () => {
    const reads: number[] = [];
    const array = derivedArray([3], [], i => { reads.push(i); return [1n, 1n, 2n][i]; });
    expect(numericSortedCounts(array)).toBeUndefined(); expect(reads).toEqual([]);
    expect(unpack(uniqueCounts(array))).toEqual([[1n, 2n], [2n, 1n]]); expect(reads).toEqual([0, 1, 2]);
});
it('declines shared buffers and keeps demand budgets', () => {
    const shared = typedArray(new Int32Array(new SharedArrayBuffer(16)));
    expect(numericSortedCounts(shared)).toBeUndefined();
    const array = typedArray(new Int32Array(10000).fill(3)), d = new RuntimeDiagnostics();
    expect(() => withDemandBudget(1, () => d.run(() => uniqueCounts(array)))).toThrow(/demand budget/);
    expect(d.numericSortedCounts).toBe(0);
});
it('polls cancellation inside long ordered scans', () => {
    const flag = new Int32Array(new SharedArrayBuffer(4)); flag[0] = 1;
    expect(() => withInterrupt(flag, () => uniqueCounts(typedArray(new Int32Array(20000))))).toThrow(/interrupt|cancel/i);
});
it('preserves source and result snapshots across later Rank writes', () => {
    const r = new Interpreter(() => {});
    try {
        r.execute('use sequences\nA = array 1 1 2 3 3\nGrouped = A unique .counts\nA 0 = 9');
        expect(unpack(r.variables.get('Grouped')!)).toEqual([[1n, 2n, 3n], [2n, 1n, 2n]]);
        expect(unpack(r.execute('A unique .counts')!)).toEqual([[9n, 1n, 2n, 3n], [1n, 1n, 1n, 2n]]);
    } finally { r.dispose(); }
});
