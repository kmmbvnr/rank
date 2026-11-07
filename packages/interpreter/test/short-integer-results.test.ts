import { expect, it } from 'vitest';
import { denseScalarItems, ownedArray, integer32Cells, integer64Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/jit/integer-array-kernel.js';

it('retains narrow and wide numeric buffers for short boxed operands', () => {
    const input = ownedArray([1n, 2n, 3n]);
    const narrow = mapStoredIntegers(input, 2n, '*')!;
    expect(integer32Cells(narrow)).toEqual(Int32Array.of(2, 4, 6));
    const wide = mapStoredIntegers(input, 3000000000n, '+')!;
    expect(integer64Cells(wide)).toEqual(BigInt64Array.of(3000000001n, 3000000002n, 3000000003n));
    const exact = mapStoredIntegers(input, 1n << 100n, '+')!;
    expect([0, 1, 2].map(i => readArrayItem(exact, i))).toEqual([1n, 2n, 3n].map(n => n + (1n << 100n)));
    narrow.items[0] = 99n;
    expect(readArrayItem(input, 0)).toBe(1n);
    expect(readArrayItem(narrow, 0)).toBe(99n);
});
it('widens after a narrow prefix without recomputing or truncating it', () => {
    const result = mapStoredIntegers(ownedArray([1n, -2n, 2147483647n]), 1n, '+')!;
    expect(integer64Cells(result)).toEqual(BigInt64Array.of(2n, -1n, 2147483648n));
    const negative = mapStoredIntegers(ownedArray([1n, -2147483648n]), 1n, '-')!;
    expect(integer64Cells(negative)).toEqual(BigInt64Array.of(0n, -2147483649n));
});
it('shares compact readers without changing indexing, iteration or slices', () => {
    const array = typedArray(Int32Array.of(-2147483648, 0, 2147483647));
    const items = denseScalarItems(array)!;
    expect(items[0]).toBe(-2147483648n);
    expect(items[3]).toBeUndefined();
    expect(Array.from(items)).toEqual([-2147483648n, 0n, 2147483647n]);
    expect(Array.from((items as unknown as { slice(start: number, end: number): BigInt64Array }).slice(1, 3)))
        .toEqual([0n, 2147483647n]);
    expect(integer32Cells(array)).toBeDefined();
    expect(array.items).toEqual([-2147483648n, 0n, 2147483647n]);
});

it.each([0n, 2147483647n, -2147483648n, 9007199254740990n, 1n << 100n])('keeps singleton %s exact through narrowing and fallback', value => {
    const result = mapStoredIntegers(ownedArray([value], [1, 1]), 1n, '+')!;
    expect(result.shape).toEqual([1, 1]);
    expect(readArrayItem(result, 0)).toBe(value + 1n);
});
