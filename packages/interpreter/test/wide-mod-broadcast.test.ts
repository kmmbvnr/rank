import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { integer32Cells, readArrayItem, typedArray } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/integer-array-kernel.js';
import { withDemandBudget, withInterrupt } from '../src/interrupt.js';

const extremes = [-(1n << 63n), -(1n << 63n) + 1n, -9007199254740993n,
    -4294967297n, -1n, 0n, 1n, 9007199254740993n, (1n << 63n) - 1n];
const values = BigInt64Array.from({ length: 257 }, (_, i) => i < extremes.length ? extremes[i]
    : BigInt.asIntN(64, BigInt(i) * 138260536507043n * BigInt(i - 128)));
const divisors = Int32Array.of(1, 2, 3, 7, 65535, 33554431, 67108863, 67108864);
const mod = (a: bigint, b: bigint) => ((a % b) + b) % b;

describe('wide integer modulo compact broadcast divisors', () => {
    it('matches BigInt at signed word and precision boundaries', () => {
        const result = mapStoredIntegers(typedArray(values, [1, values.length]),
            typedArray(divisors, [divisors.length, 1]), 'mod')!;
        expect(result.shape).toEqual([divisors.length, values.length]);
        expect(integer32Cells(result)).toBeDefined();
        for (let row = 0; row < divisors.length; row++) for (let i = 0; i < values.length; i++) {
            expect(readArrayItem(result, row * values.length + i)).toBe(mod(values[i], BigInt(divisors[row])));
        }
    });
    it('handles a compact row broadcast over wide columns', () => {
        const result = mapStoredIntegers(typedArray(values, [values.length, 1]),
            typedArray(divisors, [1, divisors.length]), 'mod')!;
        for (let row = 0; row < values.length; row++) for (let i = 0; i < divisors.length; i++) {
            expect(readArrayItem(result, row * divisors.length + i)).toBe(mod(values[row], BigInt(divisors[i])));
        }
    });
    it('handles matching vectors with varying divisors', () => {
        const right = Int32Array.from({ length: values.length }, (_, i) => divisors[i % divisors.length]);
        const result = mapStoredIntegers(typedArray(values), typedArray(right), 'mod')!;
        expect(Array.from(values, (value, i) => readArrayItem(result, i)))
            .toEqual(Array.from(values, (value, i) => mod(value, BigInt(right[i]))));
    });
    it.each([-7, 67108865])('retains exact fallback for divisor %i', divisor => {
        const result = mapStoredIntegers(typedArray(values, [1, values.length]),
            typedArray(Int32Array.of(3, divisor), [2, 1]), 'mod')!;
        for (let i = 0; i < values.length; i++) expect(readArrayItem(result, values.length + i))
            .toBe(mod(values[i], BigInt(divisor)));
    });
    it('keeps zero division and empty broadcasts on their ordinary contracts', () => {
        const runtime = new Interpreter();
        try {
            runtime.variables.set('A', typedArray(values, [1, values.length]));
            runtime.variables.set('B', typedArray(Int32Array.of(1, 0), [2, 1]));
            runtime.execute("Result' = A mod B");
            expect(runtime.execute('Result 0 0')).toBe(0n);
            expect(() => runtime.execute('Result 1 0')).toThrow(/zero/);
            runtime.variables.set('Empty', typedArray(new BigInt64Array(0), [0, 1]));
            const empty = runtime.execute('Empty mod (array 0 0)');
            if (!empty || !isRankArray(empty)) throw Error('expected array');
            expect(empty.shape).toEqual([0, 2]);
        } finally { runtime.dispose(); }
    });
    it('preserves reversed views and independent result storage', () => {
        const runtime = new Interpreter();
        try {
            runtime.variables.set('A', typedArray(values.slice()));
            runtime.execute('use sequences\nReversed = A reverse\nB = Reversed mod (array 7)\nSaved = B\nA 0 = 42\nB 0 = 3');
            const saved = runtime.variables.get('Saved');
            if (!saved || !isRankArray(saved)) throw Error('expected array');
            expect(Array.from(values, (_, i) => readArrayItem(saved, i)))
                .toEqual(Array.from(values).reverse().map(value => mod(value, 7n)));
        } finally { runtime.dispose(); }
    });
    it('retains cancellation, budget failures and retry without modifying operands', () => {
        const left = typedArray(BigInt64Array.from({ length: 5000 }, (_, i) => values[i % values.length]), [1, 5000]);
        const right = typedArray(Int32Array.of(7, 11), [2, 1]);
        expect(() => withInterrupt(new Int32Array([1]), () => mapStoredIntegers(left, right, 'mod'))).toThrow('Interrupted');
        expect(() => withDemandBudget(0, () => mapStoredIntegers(left, right, 'mod'))).toThrow('demand budget exhausted');
        expect(readArrayItem(left, 0)).toBe(extremes[0]);
        const result = mapStoredIntegers(left, right, 'mod')!;
        expect(readArrayItem(result, 5000)).toBe(mod(extremes[0], 11n));
    });
});
