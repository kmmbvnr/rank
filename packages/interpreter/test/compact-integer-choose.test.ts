import { expect, it } from 'vitest';
import { ownedArray, readArrayItem, typedArray, writeArrayCell } from '../src/array-storage.js';
import { registerScalarView } from '../src/integer-view.js';
import { chooseStoredIntegers } from '../src/jit/integer-array-kernel.js';
import { DemandBudgetExhausted, withDemandBudget } from '../src/interrupt.js';
import type { RankArray } from '../src/value.js';
const items = (value: RankArray) => Array.from({ length: value.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(value, i));
it.each([0, 1, 31, 32, 33, 4097])('preserves signed cells and bitmap tails at %i', size => {
    const bits = Array.from({ length: size }, (_, i) => i % 3 === 0);
    const data = Int32Array.from(bits, (_, i) => i % 2 ? -2147483648 : 2147483647);
    const yes = typedArray(data), result = chooseStoredIntegers(ownedArray(bits), yes, -7n, [size])!;
    if (!size) { expect(result).toBeUndefined(); return; }
    expect(items(result)).toEqual(bits.map((hit, i) => hit ? BigInt(data[i]) : -7n));
    if (size) { writeArrayCell(yes, 0, 42n); expect(readArrayItem(result, 0)).toBe(2147483647n); }
});
it.each([false, true])('validates only selected branches and honors reversed views (pure=%s)', pureCheck => {
    const source = typedArray(Int32Array.of(1, 2, 3)), reads: bigint[] = [];
    const reverse = registerScalarView<RankArray>({ kind: 'array', shape: [3], items: [], itemAt: i => BigInt(3 - i) },
        source, i => 2 - i, { linear: () => ({ offset: 2, stride: -1 }), scalarCheck: true, pureCheck,
            check: value => { reads.push(value as bigint); return value; } });
    expect(items(chooseStoredIntegers(false, reverse, 0n, [3])!)).toEqual([0n, 0n, 0n]);
    expect(reads).toEqual([]);
    expect(items(chooseStoredIntegers(true, reverse, 0n, [3])!)).toEqual([3n, 2n, 1n]);
    expect(reads).toEqual(pureCheck ? [3n] : [3n, 2n, 1n]);
});
it('retains wide values and broadcasting', () => {
    const result = chooseStoredIntegers(ownedArray([true, false, true, false], [2, 2]),
        typedArray(Int32Array.of(11, 12), [2]), 1n << 70n, [2, 2])!;
    expect(items(result)).toEqual([11n, 1n << 70n, 11n, 1n << 70n]);
});
it('keeps bounded demand cancellable', () => {
    expect(() => withDemandBudget(1, () => chooseStoredIntegers(ownedArray(Array(8193).fill(true)), 1n, 2n, [8193])))
        .toThrow(DemandBudgetExhausted);
});
