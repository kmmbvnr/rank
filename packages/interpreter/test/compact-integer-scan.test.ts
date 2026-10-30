import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { integer32Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { scanInt32Axis } from '../src/axis-order.js';
import { DemandBudgetExhausted, InterruptedError, withDemandBudget, withInterrupt } from '../src/interrupt.js';

for (const compilation of [true, false]) describe(`compact integer scan (compilation=${compilation})`, () => {
    it('keeps long small prefixes packed and respects a seed', () => {
        const n = 2 ** 21 + 17;
        const cells = new Int32Array(n).fill(1);
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('use sequences');
            runtime.variables.set('Cells', typedArray(cells, [n]));
            const result = runtime.execute('Cells scan +');
            expect(isRankArray(result)).toBe(true);
            if (!isRankArray(result)) throw new Error('expected an array');
            expect(integer32Cells(result)).toBeDefined();
            for (const i of [0, 4095, 4096, n - 1]) expect(readArrayItem(result, i)).toBe(BigInt(i + 1));
            expect(cells[n - 1]).toBe(1);
            expect(runtime.execute('(Cells take 3) scan + with 7')).toMatchObject({ shape: [4] });
            expect(runtime.execute('((Cells take 3) scan + with 7) last')).toBe(10n);
        } finally { runtime.dispose(); }
    });

    it('falls back to exact integers above Number range without changing the input', () => {
        const n = 2 ** 22 + 1;
        const runtime = new Interpreter(() => {}, { compilation });
        const cells = new Int32Array(n).fill(2147483647);
        try {
            runtime.execute('use sequences');
            runtime.variables.set('Cells', typedArray(cells, [n]));
            expect(runtime.execute('(Cells scan +) last')).toBe(BigInt(n) * 2147483647n);
            expect(cells[0]).toBe(2147483647);
            expect(cells[n - 1]).toBe(2147483647);
        } finally { runtime.dispose(); }
    }, 15_000);
});

it('widens safe positive and negative prefixes to integers and rejects unsafe ones', () => {
    const n = 2 ** 21 + 1;
    for (const x of [2147483647, -2147483648]) {
        const input = typedArray(new Int32Array(n).fill(x), [n]);
        const result = scanInt32Axis('+', input, [n], 0);
        expect(result).toBeDefined();
        expect(readArrayItem(result!, n - 1)).toBe(BigInt(n) * BigInt(x));
    }
    const m = 2 ** 22 + 1;
    const input = typedArray(new Int32Array(m).fill(-2147483648), [m]);
    expect(scanInt32Axis('+', input, [m], 0)).toBeUndefined();
});

it('does not publish a partial scan when work is cancelled or its budget expires', () => {
    const cells = new Int32Array(16384).fill(1);
    const input = typedArray(cells, [cells.length]);
    expect(() => withDemandBudget(4096, () => scanInt32Axis('+', input, input.shape, 0)))
        .toThrow(DemandBudgetExhausted);
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(signal, 0, 1);
    expect(() => withInterrupt(signal, () => scanInt32Axis('+', input, input.shape, 0)))
        .toThrow(InterruptedError);
    expect(cells[0]).toBe(1);
    expect(cells[cells.length - 1]).toBe(1);
    expect(readArrayItem(scanInt32Axis('+', input, input.shape, 0)!, 16383)).toBe(16384n);
});

it('declines speculative scanning during observable host polling or inspection', () => {
    const input = typedArray(Int32Array.of(1, 2, 3), [3]);
    const signal = { length: 1, load: () => 0, store() {}, exchange: () => 0, wait() {} };
    expect(withInterrupt(signal, () => scanInt32Axis('+', input, [3], 0))).toBeUndefined();
    const shared = new Int32Array(new SharedArrayBuffer(12));
    expect(withInterrupt(shared, () => scanInt32Axis('+', input, [3], 0), () => {})).toBeUndefined();
});
