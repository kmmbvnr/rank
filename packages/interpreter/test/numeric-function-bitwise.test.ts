import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type NativeFunction, type RankArray } from '../src/index.js';
import { integer32Cells, typedArray, readArrayItem } from '../src/array-storage.js';

function fixture(operator: string, compilation = true, bits = true) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { compilation, scalarFunctionCompilation: false });
    runtime.execute(`${bits ? 'use bits' : ''}
use sequences
fun Values combine Mask
 Grid = Values reshape #
 return Grid ${operator} Mask
end`);
    const fn = runtime.variables.get('combine') as NativeFunction;
    return { runtime, diagnostics, call: (values: RankArray, mask: bigint | number) =>
        diagnostics.run(() => fn.call([values, mask])) as RankArray };
}
const cells = (value: RankArray) => Array.from({ length: value.shape.reduce((a, b) => a * b, 1) }, (_, i) => readArrayItem(value, i));
const values = [0, 1, 2, 3, 7, 32768, 1073741824, 2147483647];
const apply = (op: string, a: bigint, b: bigint) => op === 'band' ? a & b : op === 'bor' ? a | b : a ^ b;

describe.each(['band', 'bor', 'bxor'])('numeric functions %s', operator => {
    it.each([0n, 1n, 255n, 1073741824n, 2147483647n])('keeps nonnegative Int32 bit arithmetic exact at mask %s', mask => {
        const f = fixture(operator);
        try {
            const out = f.call(typedArray(Int32Array.from(values)), mask);
            expect(cells(out)).toEqual(values.map(v => apply(operator, BigInt(v), mask)));
            expect(integer32Cells(out)).toBeDefined();
            expect(f.diagnostics.compiledArrayFunctions).toBe(1);
        } finally { f.runtime.dispose(); }
    });
    it.each([-1n, 2147483648n, 1n << 53n, 1n << 100n])('retains exact fallback for mask %s', mask => {
        const f = fixture(operator);
        try {
            expect(cells(f.call(typedArray(Int32Array.from(values)), mask)))
                .toEqual(values.map(v => apply(operator, BigInt(v), mask)));
            expect(f.diagnostics.compiledArrayFunctions).toBe(0);
        } finally { f.runtime.dispose(); }
    });
    it('retains negative input and real-mask behavior', () => {
        const f = fixture(operator);
        try {
            expect(cells(f.call(typedArray(new Int32Array([-1, -2147483648, 1])), 7n)))
                .toEqual([-1n, -2147483648n, 1n].map(v => apply(operator, v, 7n)));
            expect(() => cells(f.call(typedArray(Int32Array.from(values)), 7.5))).toThrow();
            expect(f.diagnostics.compiledArrayFunctions).toBe(0);
        } finally { f.runtime.dispose(); }
    });
    it('requires the bits module', () => {
        const f = fixture(operator, true, false);
        try { expect(() => f.call(typedArray(Int32Array.from(values)), 7n)).toThrow(); }
        finally { f.runtime.dispose(); }
    });
});

it('keeps chained permutation helpers compact and preserves their inputs', () => {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: false });
    try {
        runtime.execute(`use bits
use sequences
fun Values butterfly Half
 Size = Values len
 Indices = 0 till Size
 Other = Values (Indices bxor Half)
 Bit = (Indices band Half) // Half
 return Other + Values * (1 - 2 * Bit)
end`);
        const fn = runtime.variables.get('butterfly') as NativeFunction;
        const input = Int32Array.from({ length: 256 }, (_, i) => i % 13 - 6), saved = input.slice();
        let actual = typedArray(input), expected = [...input].map(BigInt);
        for (let half = 1; half < 256; half *= 2) {
            actual = diagnostics.run(() => fn.call([actual, BigInt(half)])) as RankArray;
            expected = expected.map((v, i) => expected[i ^ half] + v * BigInt(i & half ? -1 : 1));
            expect(cells(actual)).toEqual(expected);
            expect(integer32Cells(actual)).toBeDefined();
        }
        expect(diagnostics.compiledArrayFunctions).toBe(8);
        expect(input).toEqual(saved);
    } finally { runtime.dispose(); }
});

it.each([1073741823, 1073741824, -1073741825])('publishes concatenated integer stages without narrowing overflow at %s', value => {
    const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: false });
    try {
        runtime.execute(`use sequences
fun Values tensorStage
 Cube = Values reshape 2 2
 unpack Left Right = Cube axis 1
 Plus = Left + Right
 Minus = Left - Right
 Top = Plus reshape 2 1
 Bottom = Minus reshape 2 1
 Joined = concat Top Bottom axis 1
 return Joined reshape 4
end`);
        const fn = runtime.variables.get('tensorStage') as NativeFunction;
        const out = fn.call([typedArray(new Int32Array(4).fill(value))]) as RankArray;
        expect(Boolean(integer32Cells(out))).toBe(value === 1073741823);
        expect(cells(out)).toEqual([BigInt(value) * 2n, 0n, BigInt(value) * 2n, 0n]);
    } finally { runtime.dispose(); }
});
