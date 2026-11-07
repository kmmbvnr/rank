import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankValue } from '../src/index.js';
import { typedArray, ownedArray, integer32Cells, readArrayItem } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/jit/integer-array-kernel.js';
import { withInterrupt, InterruptedError, withDemandBudget, DemandBudgetExhausted } from '../src/interrupt.js';
const rows = 129, width = 128;
const left = Array.from({ length: rows }, (_, i) => BigInt(i - 64));
const right = Array.from({ length: width }, (_, i) => BigInt(i - 63));
function result(a: bigint, b: bigint, op: string): bigint {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === 'min') return a < b ? a : b;
    if (op === 'max') return a > b ? a : b;
    a = a < 0n ? -a : a; b = b < 0n ? -b : b;
    while (b) { const r = a % b; a = b; b = r; }
    return a;
}
const cells = (value: RankValue | undefined) => {
    if (!value || !isRankArray(value)) throw Error('expected array');
    return Array.from({ length: value.shape.reduce((n, d) => n * d, 1) }, (_, i) => readArrayItem(value, i));
};
describe('amortized stored integer broadcast lanes', () => {
    for (const mixed of [false, true]) for (const reversed of [false, true]) {
        it.each(['+', '-', '*', 'min', 'max', 'gcd'])(`matches exact signed arithmetic: %s, mixed=${mixed}, reversed=${reversed}`, op => {
            // A typed subarray keeps a nonzero backing-buffer offset.
            const backing = new BigInt64Array(rows + 5); backing.set(left, 5);
            const a = typedArray(backing.subarray(5), [3, 43, 1]);
            const b = mixed ? typedArray(Int32Array.from(right, Number), [1, 1, width])
                : typedArray(BigInt64Array.from(right), [1, 1, width]);
            const actual = mapStoredIntegers(reversed ? b : a, reversed ? a : b, op);
            expect(cells(actual)).toEqual(left.flatMap(x => right.map(y => result(reversed ? y : x, reversed ? x : y, op))));
            if (!actual || !isRankArray(actual)) throw Error('expected array');
            expect(integer32Cells(actual)).toBeDefined();
        });
    }
    it.each([2147483647n, -2147483648n, 2n ** 60n, -(2n ** 60n), 2n ** 100n])('preserves exact fallback for wide values %s', edge => {
        const a = [...left]; a[rows - 1] = edge;
        const runtime = new Interpreter();
        runtime.variables.set('Left', edge > 2n ** 63n ? ownedArray(a, [rows, 1]) : typedArray(BigInt64Array.from(a), [rows, 1]));
        runtime.variables.set('Right', typedArray(Int32Array.from(right, Number), [1, width]));
        try {
            for (const op of ['+', '-', '*', 'min', 'max']) {
                expect(cells(runtime.execute(`Left ${op} Right`))).toEqual(a.flatMap(x => right.map(y => result(x, y, op))));
            }
        } finally { runtime.dispose(); }
    });
    it('retains demand budgets and cancellation during lane conversion', () => {
        const a = typedArray(new BigInt64Array(8193).fill(7n), [8193, 1]);
        const b = typedArray(new Int32Array(64).fill(3), [1, 64]);
        expect(() => withInterrupt(new Int32Array([1]), () => mapStoredIntegers(a, b, '+'))).toThrow(InterruptedError);
        const runtime = new Interpreter(); runtime.variables.set('Left', a); runtime.variables.set('Right', b);
        try {
            expect(() => withDemandBudget(1, () => runtime.execute('Result = Left + Right'))).toThrow(DemandBudgetExhausted);
            expect(runtime.variables.has('Result')).toBe(false);
        } finally { runtime.dispose(); }
    });
});
