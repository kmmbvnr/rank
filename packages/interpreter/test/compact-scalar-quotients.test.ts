import { expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/jit/integer-array-kernel.js';
import { withDemandBudget, withInterrupt, InterruptedError } from '../src/interrupt.js';

function divide(n: bigint, d: bigint) {
    const q = n / d, r = n % d;
    return r !== 0n && (r < 0n) !== (d < 0n) ? q - 1n : q;
}
const divisors = [2147483647, -2147483648, 1048573, -1048573, 3, -3, 1, -1];
it.each([2147483648n, -2147483649n, 1000000000000n, -1000000000000n,
    4503599627370495n, -4503599627370495n, 4503599627370496n,
    9007199254740991n, 9007199254740992n, 1n << 100n])('keeps scalar %s division exact over compact denominators', n => {
    const values = typedArray(Int32Array.from(divisors), [2, 4]);
    const result = mapStoredIntegers(n, values, '//')!;
    expect(result.shape).toEqual([2, 4]);
    expect(divisors.map((_, i) => readArrayItem(result, i))).toEqual(divisors.map(d => divide(n, BigInt(d))));
});
it('covers quotients immediately below and above integer boundaries', () => {
    for (const q of [2147483647n, -2147483648n, 1234567n, -1234567n]) {
        for (const d of [1048573n, -1048573n]) for (const offset of [-1n, 0n, 1n]) {
            const n = q * d + offset;
            const result = mapStoredIntegers(n, typedArray(Int32Array.of(Number(d))), '//')!;
            expect(readArrayItem(result, 0)).toBe(divide(n, d));
        }
    }
});
it('discards a narrow prefix before a later wide quotient', () => {
    const n = 1000000000000n;
    const result = mapStoredIntegers(n, typedArray(Int32Array.of(1000000, 1, -1)), '//')!;
    expect([0, 1, 2].map(i => readArrayItem(result, i))).toEqual([1000000n, n, -n]);
});
it('retains empty shapes and strided denominator views', () => {
    const empty = mapStoredIntegers(1000000000000n, typedArray(new Int32Array(), [2, 0]), '//')!;
    expect(empty.shape).toEqual([2, 0]);
    const runtime = new Interpreter(() => {}, { compilation: false });
    try {
        runtime.execute('use sequences\nValues = 1000 to 1099 copy\nValues = Values * Values\nSlice = Values (99 to 0 by -3)\nResult = 1000000000000 // Slice');
        expect(formatValue(runtime.variables.get('Result')!)).toBe(Array.from({ length: 34 }, (_, i) => String(divide(1000000000000n, BigInt(1099 - 3 * i) ** 2n))).join(' '));
    } finally { runtime.dispose(); }
});
it('does not eagerly expose a zero divisor in a deferred result', () => {
    const runtime = new Interpreter(() => {}, { compilation: false });
    try {
        runtime.variables.set('Values', typedArray(Int32Array.of(1000000, 0)));
        runtime.execute("Result' = 1000000000000 // Values");
        expect(runtime.execute('Result 0')).toBe(1000000n);
        expect(() => runtime.execute('Result 1')).toThrow('division by zero');
    } finally { runtime.dispose(); }
});
it('remains cancellable before publishing a result', () => {
    const values = typedArray(new Int32Array(8192).fill(1000000));
    expect(() => withInterrupt(new Int32Array([1]), () => mapStoredIntegers(1000000000000n, values, '//'))).toThrow(InterruptedError);
});
it('keeps native demand work and its located failure unchanged', () => {
    const observed: unknown[] = [];
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.variables.set('Values', typedArray(new Int32Array(8192).fill(1000000)));
            let error: string | undefined;
            try { withDemandBudget(50, () => runtime.execute('Result = 1000000000000 // Values')); }
            catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
            expect(error).toContain('demand budget exhausted');
            observed.push({ error, result: runtime.variables.has('Result') });
        } finally { runtime.dispose(); }
    }
    expect(observed[1]).toEqual(observed[0]);
});
