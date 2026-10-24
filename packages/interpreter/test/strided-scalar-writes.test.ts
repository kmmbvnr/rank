import { describe, expect, it } from 'vitest';
import { Interpreter, type RankArray } from '../src/index.js';
import { filledArray, readArrayItem, typedArray, writeArrayCell, writeIntegerSelection } from '../src/array-storage.js';
import { ownedStorage } from '../src/array-storage-state.js';
import { arrayRevision } from '../src/array-revision.js';
import { DemandBudgetExhausted, InterruptedError, withDemandBudget, withInterrupt } from '../src/interrupt.js';

// Exercise compact buffers: small literal arrays use the boxed fallback.
describe.each([false, true])('typed scalar selection replacement (linear=%s)', linear => {
    it.each([
        [new Int32Array(8192), -2147483648n],
        [new Int32Array(8192), 2147483647n],
        [new BigInt64Array(8192), -(1n << 63n)],
        [new BigInt64Array(8192), (1n << 63n) - 1n],
    ])('keeps storage and updates the revision for %s with %s', (cells, replacement) => {
        const array = typedArray(cells), before = arrayRevision(array);
        writeIntegerSelection(array, 2730, i => 8190 - i * 3, replacement, '=', linear ? { offset: 8190, stride: -3 } : undefined);
        expect(ownedStorage.get(array)!.typed).toBe(cells);
        expect(arrayRevision(array)).not.toBe(before);
        expect(readArrayItem(array, 8190)).toBe(replacement);
        expect(readArrayItem(array, 3)).toBe(replacement);
        expect(readArrayItem(array, 4)).toBe(0n);
    });

    it.each([2147483648n, -2147483649n, 1n << 80n])('widens exactly for %s', replacement => {
        const array = filledArray(7n, [8192]);
        writeIntegerSelection(array, 2, i => 1 + i * 3, replacement, '=', linear ? { offset: 1, stride: 3 } : undefined);
        expect(readArrayItem(array, 1)).toBe(replacement);
        expect(readArrayItem(array, 4)).toBe(replacement);
        expect(readArrayItem(array, 2)).toBe(7n);
    });

    it('preserves arbitrary offsets and duplicate replacements', () => {
        const array = filledArray(0n, [8192]), offsets = [9, 3, 9, 1];
        writeIntegerSelection(array, offsets.length, i => offsets[i], 5n, '=');
        expect(offsets.map(i => readArrayItem(array, i))).toEqual([5n, 5n, 5n, 5n]);
        expect(readArrayItem(array, 0)).toBe(0n);
    });

    it.each([0, 1, 1023, 1024, 1025])('writes exactly %s cells across polling blocks', count => {
        const array = filledArray(0n, [8192]);
        writeIntegerSelection(array, count, i => 7 + i * 2, 11n, '=',
            linear ? { offset: 7, stride: 2 } : undefined);
        expect(readArrayItem(array, 7 + count * 2)).toBe(0n);
        expect(readArrayItem(array, 6)).toBe(0n);
        if (count) expect(readArrayItem(array, 7 + (count - 1) * 2)).toBe(11n);
    });

    it('does not widen or evaluate offsets for an empty write', () => {
        const array = filledArray(0n, [8192]), cells = ownedStorage.get(array)!.typed;
        writeIntegerSelection(array, 0, () => { throw new Error('empty offset'); }, 1n << 80n, '=', linear ? { offset: 0, stride: 1 } : undefined);
        expect(ownedStorage.get(array)!.typed).toBe(cells);
    });

    it('honors cancellation before the first stored cell', () => {
        const array = filledArray(0n, [8192]), flag = new Int32Array(new SharedArrayBuffer(4));
        flag[0] = 1;
        expect(() => withInterrupt(flag, () => writeIntegerSelection(array, 8192, i => i, 7n, '=', linear ? { offset: 0, stride: 1 } : undefined)))
            .toThrow(InterruptedError);
        expect(readArrayItem(array, 8191)).toBe(0n);
    });

    it('charges every write to a demand budget', () => {
        const array = filledArray(0n, [8192]);
        expect(() => withDemandBudget(1024, () => writeIntegerSelection(array, 8192, i => i, 7n, '=',
            linear ? { offset: 0, stride: 1 } : undefined))).toThrow(DemandBudgetExhausted);
        expect(readArrayItem(array, 1023)).toBe(7n);
        expect(readArrayItem(array, 1024)).toBe(0n);
    });

    it('reloads storage after an observable host poll widens the buffer', () => {
        const array = filledArray(0n, [8192]);
        let polled = false;
        const signal = {
            length: 1, load: () => 0, store() {}, wait() {},
            exchange: () => {
                if (!polled) { polled = true; writeArrayCell(array, 8191, 1n << 80n); }
                return 0;
            },
        };
        withInterrupt(signal, () => writeIntegerSelection(array, 8192, i => i, 7n, '=',
            linear ? { offset: 0, stride: 1 } : undefined));
        expect(polled).toBe(true);
        expect(readArrayItem(array, 2048)).toBe(7n);
        expect(readArrayItem(array, 8191)).toBe(7n);
    });
});

describe.each([false, true])('compact slice assignment (compilation=%s)', compilation => {
    it('protects aliases and retained selections through ascending and descending writes', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute(`A = array shape 8192 fill 0
Alias = A
Cut = A (0 to 10 by 2)
for P in 2 to 3
 A (P to 8191 by P) = P
end
A (8190 to 8180 by -2) = -2147483648
A (0 till 0) = 18446744073709551616`);
            const array = runtime.variables.get('A') as RankArray;
            expect(runtime.execute('Alias sum')).toBe(0n);
            expect(runtime.execute('Cut sum')).toBe(0n);
            expect(readArrayItem(array, 6)).toBe(3n);
            expect(readArrayItem(array, 8)).toBe(2n);
            expect(readArrayItem(array, 8190)).toBe(-2147483648n);
            expect(ownedStorage.get(array)!.typed).toBeInstanceOf(Int32Array);
            expect(() => runtime.execute('A (8190 to 8194) = 9')).toThrow('out of bounds');
            expect(readArrayItem(array, 8190)).toBe(-2147483648n);
        } finally { runtime.dispose(); }
    });
});
