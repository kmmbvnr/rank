import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { integer64Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { scanInt64 } from '../src/axis-order.js';
import { DemandBudgetExhausted, withDemandBudget, withInterrupt } from '../src/interrupt.js';

for (const compilation of [false, true]) describe(`Int64 scan (${compilation})`, () => {
    it('keeps exact wide prefixes packed and preserves the input', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        const cells = BigInt64Array.of(1000000000000000000n, -3n, 7n);
        try {
            runtime.execute('use sequences');
            runtime.variables.set('Cells', typedArray(cells, [3]));
            const result = runtime.execute('Cells scan +')!;
            expect(integer64Cells(result as ReturnType<typeof typedArray>)).toBeDefined();
            expect(formatValue(result)).toBe('1000000000000000000 999999999999999997 1000000000000000004');
            expect(runtime.execute('((Cells scan + with 2) last)')).toBe(1000000000000000006n);
            expect(cells[0]).toBe(1000000000000000000n);
        } finally { runtime.dispose(); }
    });

    it.each([1n, -1n])('falls back when an intermediate prefix overflows (%s)', sign => {
        const runtime = new Interpreter(() => {}, { compilation });
        const cells = BigInt64Array.of(sign * 9223372036854775807n, sign * 2n, -sign * 2n);
        const source = typedArray(cells, [3]);
        try {
            expect(scanInt64(source)).toBeUndefined();
            runtime.variables.set('Cells', source);
            expect(formatValue(runtime.execute('Cells scan +')!)).toBe(
                [...cells].reduce<bigint[]>((out, x) => [...out, (out.at(-1) ?? 0n) + x], []).join(' '));
        } finally { runtime.dispose(); }
    });
});

it('keeps cancellation and observable polling on their existing paths', () => {
    const input = typedArray(new BigInt64Array(8192).fill(3n), [8192]);
    expect(() => withDemandBudget(4096, () => scanInt64(input))).toThrow(DemandBudgetExhausted);
    const host = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
    expect(withInterrupt(host, () => scanInt64(input))).toBeUndefined();
    expect(readArrayItem(input, 8191)).toBe(3n);
    expect(scanInt64(typedArray(new BigInt64Array(0), [0]))).toMatchObject({ shape: [0] });
});
