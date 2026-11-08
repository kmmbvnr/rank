import { expect, it } from 'vitest';
import { consumeSafeIntegerBuffer } from '../src/owned-array.js';

it('reuses private storage with exact signed words at every width boundary', () => {
    const values = [Number.MIN_SAFE_INTEGER, -(2 ** 48) - 1, -4294967297, -4294967296,
        -2147483649, -2147483648, -1, -0, 0, 1, 2147483647, 2147483648,
        4294967295, 4294967296, 4294967297, 2 ** 48 + 1, Number.MAX_SAFE_INTEGER];
    const cells = Float64Array.from(values), expected = values.map(BigInt);
    const packed = consumeSafeIntegerBuffer(cells);
    expect(packed.buffer).toBe(cells.buffer);
    expect(Array.from(packed)).toEqual(expected);
});
it('consumes only the logical slice and accepts empty buffers', () => {
    const cells = Float64Array.of(123.5, -4294967297, 9007199254740991, 456.5);
    const result = consumeSafeIntegerBuffer(cells.subarray(1, 3));
    expect(result.byteOffset).toBe(8);
    expect(Array.from(result)).toEqual([-4294967297n, 9007199254740991n]);
    expect(cells[0]).toBe(123.5); expect(cells[3]).toBe(456.5);
    expect(consumeSafeIntegerBuffer(new Float64Array()).length).toBe(0);
});
