import { expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { readArrayItem, typedArray, writeArrayCell } from '../src/array-storage.js';
import { checkpoint, InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { mapDenseArrays } from '../src/tensor.js';

const comparisons = {
    equal: (a: bigint, b: bigint) => a === b,
    'not equal': (a: bigint, b: bigint) => a !== b,
    less: (a: bigint, b: bigint) => a < b,
    greater: (a: bigint, b: bigint) => a > b,
    'at most': (a: bigint, b: bigint) => a <= b,
    'at least': (a: bigint, b: bigint) => a >= b,
};

for (const [name, compare] of Object.entries(comparisons)) {
    for (const reversed of [false, true]) it(`compares ${name}, reversed=${reversed}, while inspecting`, () => {
        const runtime = new Interpreter(undefined, { compilation: false });
        const values = Int32Array.from({ length: 8193 }, (_, i) => [-2147483648, -1, 0, 1, 2147483647][i % 5]);
        runtime.variables.set('Input', typedArray(values, [3, 2731]));
        const flag = new Int32Array(new SharedArrayBuffer(12));
        try {
            const result = withInterrupt(flag, () => runtime.execute(reversed
                ? `0 ${name} Input` : `Input ${name} 0`), () => {}) as RankArray;
            expect(result.shape).toEqual([3, 2731]);
            expect(Array.from(values, (value, i) => readArrayItem(result, i))).toEqual(
                Array.from(values, value => reversed ? compare(0n, BigInt(value)) : compare(BigInt(value), 0n)));
        } finally { runtime.dispose(); }
    });
}

it.each([0, 4096])('reloads storage widened before cell %s', changed => {
    const input = typedArray(new Int32Array(8192).fill(1));
    let polled = false;
    const signal: InterruptSignal = {
        length: 1, load: () => 0, store() {}, wait() {},
        exchange() {
            if (!polled) { polled = true; writeArrayCell(input, changed, 1n << 80n); }
            return 0;
        },
    };
    const result = withInterrupt(signal, () => {
        checkpoint('warmup', 1023 - changed / 4096);
        return mapDenseArrays(input, 5n, (a, b) => (a as bigint) > (b as bigint), -1, false, 'greater');
    }, () => {})!;
    expect(polled).toBe(true);
    expect(readArrayItem(result, changed)).toBe(true);
    expect(readArrayItem(result, 1)).toBe(false);
    expect(readArrayItem(result, 8191)).toBe(false);
});

it('compares a retained reverse-strided selection while inspecting', () => {
    const runtime = new Interpreter(undefined, { compilation: false });
    const flag = new Int32Array(new SharedArrayBuffer(12));
    try {
        runtime.execute('use sequences\nInput = 0 till 8193 array\nCut = Input (8190 to 0 by -2)');
        expect(withInterrupt(flag, () => runtime.execute('(Cut less 4096) count'), () => {})).toBe(2048n);
        expect(withInterrupt(flag, () => runtime.execute('(4096 greater Cut) count'), () => {})).toBe(2048n);
    } finally { runtime.dispose(); }
});

it('keeps cancellation at the native comparison checkpoint', () => {
    const flag = new Int32Array(new SharedArrayBuffer(12));
    const input = typedArray(new Int32Array(8192));
    flag[0] = 1;
    expect(() => withInterrupt(flag, () => {
        checkpoint('warmup', 1023);
        return mapDenseArrays(input, 0n, (a, b) => a === b, -1, false, 'equal');
    }, () => {})).toThrow(InterruptedError);
});

it('leaves lazy host operands unread', () => {
    let reads = 0;
    const input: RankArray = { kind: 'array', shape: [8192], items: [], itemAt() { reads++; return 1n; } };
    const flag = new Int32Array(new SharedArrayBuffer(12));
    expect(withInterrupt(flag, () => mapDenseArrays(input, 0n, (a, b) => a === b, -1, false, 'equal'), () => {}))
        .toBeUndefined();
    expect(reads).toBe(0);
});
