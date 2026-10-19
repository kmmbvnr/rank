import { describe, expect, it } from 'vitest';
import { integerSquareRoot } from '../src/integer-square-root.js';
import { ownedArray } from '../src/array-storage.js';
import { Interpreter, formatValue, isRankArray, type NativeFunction } from '../src/index.js';
import { InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { numbersModule } from '../src/modules/numbers.js';
import type { RuntimeContext } from '../src/modules/types.js';
import { scalarBuiltinArray } from '../src/scalar-builtin.js';

// Independent integer-only oracle, including for inputs using the new estimate.
function newton(n: bigint): bigint {
    if (n < 2n) return n;
    let r = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
    for (;;) {
        const next = (r + n / r) >> 1n;
        if (next >= r) return r;
        r = next;
    }
}
const rootFunction = () => numbersModule.isqrt({} as RuntimeContext) as NativeFunction;
function mapped(values: bigint[]) {
    const source = ownedArray(values, [values.length]);
    const result = scalarBuiltinArray(source, rootFunction(), [0]);
    expect(result).toBeDefined();
    return { source, result: result! };
}

function run(source: string): string {
    const runtime = new Interpreter();
    try { return formatValue(runtime.execute('use numbers\nuse sequences\n' + source)!); }
    finally { runtime.dispose(); }
}

describe('exact square-root estimates', () => {
    it('matches the independent oracle and square inequalities across the cutoff', () => {
        const cases: bigint[] = [];
        for (let n = 0n; n < 10000n; n++) cases.push(n);
        for (const k of [2n, 3n, 2n ** 26n, 2n ** 27n, 2n ** 31n,
            3037000499n, 3037000500n, 2n ** 32n, 2n ** 64n, 2n ** 100n]) {
            for (let d = -8n; d <= 8n; d++) if (k * k + d >= 0n) cases.push(k * k + d);
        }
        for (const edge of [1n << 53n, 1n << 63n]) {
            for (let d = -32n; d <= 32n; d++) cases.push(edge + d);
        }
        let seed = 0x7abcd123456789n;
        for (let i = 0; i < 10000; i++) {
            seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
            cases.push(seed);
        }
        for (const n of cases) {
            const r = integerSquareRoot(n);
            expect(r).toBe(newton(n));
            expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
        }
    });

    it('keeps arbitrary precision for very large inputs', () => {
        for (const bits of [64n, 128n, 1024n, 10000n]) {
            const r = (1n << bits) + 17n;
            expect(integerSquareRoot(r * r - 1n)).toBe(r - 1n);
            expect(integerSquareRoot(r * r)).toBe(r);
            expect(integerSquareRoot(r * r + 1n)).toBe(r);
        }
    });
});

describe('stored scalar builtin arrays', () => {
    it('maps across the floating estimate cutoff without narrowing integers', () => {
        const inputs = [(1n << 53n) - 1n, 1n << 53n, (1n << 63n) - 1n, 1n << 63n, 1n << 128n];
        expect(mapped(inputs).result.items).toEqual(inputs.map(newton));
    });

    it('keeps later domain errors lazy and retries after a source write', () => {
        const { source, result } = mapped([4n, -1n, 16n]);
        expect(result.shape).toEqual([3]);
        expect(result.itemAt!(0)).toBe(2n);
        expect(result.itemAt!(2)).toBe(4n);
        expect(() => result.items).toThrow('isqrt expects a nonnegative integer');
        source.items[1] = 9n;
        expect(result.items).toEqual([2n, 3n, 4n]);
    });

    it('demands the first cell when shape is requested', () => {
        const { source, result } = mapped([-1n, 9n]);
        expect(() => result.shape).toThrow('isqrt expects a nonnegative integer');
        source.items[0] = 0n;
        expect(result.shape).toEqual([2]);
        expect(result.itemAt!(0)).toBe(0n);
    });

    it('invalidates first-cell and materialized caches on writes', () => {
        const { source, result } = mapped([0n, 9n, 16n]);
        const initial = result.items;
        expect(result.items).toBe(initial);
        source.items[0] = 25n;
        source.items[2] = 36n;
        expect(result.shape).toEqual([3]);
        expect(result.itemAt!(0)).toBe(5n);
        expect(result.items).toEqual([5n, 3n, 6n]);
        expect(initial).toEqual([0n, 3n, 4n]);
        // Host edits to a materialized result are not source edits.
        result.items[1] = 99n;
        expect(result.itemAt!(1)).toBe(3n);
    });

    it('retains shape for intrinsic, explicit, permuted and empty frames', () => {
        const source = 'A = array 0 1 4 9 16 25 shape 2 3\n';
        expect(run(source + 'A isqrt')).toBe('0 1 2 3 4 5');
        expect(run(source + '(A isqrt) shape')).toBe('2 3');
        expect(run(source + 'A isqrt rank 0')).toBe('0 1 2 3 4 5');
        expect(run(source + '(A isqrt axis 1 0 rank 0) shape')).toBe('3 2');
        expect(run('(array shape 0 3 fill 0) isqrt shape')).toBe('0 3');
        expect(run('(array shape 3 0 fill 0) isqrt shape')).toBe('3 0');
    });

    it.each(['-1', '2.25', '"x"', '.NA'])('preserves scalar errors for %s in stored arrays', value => {
        expect(() => run(`(array ${value} ${value}) isqrt sum`)).toThrow();
    });

    it('retains a COW alias and ordinary user function dispatch', () => {
        expect(run(`A = array 4 9 16
B = A
Roots = B isqrt
A 1 = 25
Roots sum`)).toBe('9');
        const runtime = new Interpreter();
        try {
            expect(formatValue(runtime.execute(`fun X isqrt
 return X + 10
end
(array 1 2 3) isqrt rank 0`)!)).toBe('11 12 13');
        } finally { runtime.dispose(); }
    });

    it('does not speculate over opaque host cells or noncanonical axes', () => {
        const reads: number[] = [];
        const host = { kind: 'array' as const, shape: [3], items: [],
            itemAt(index: number) { reads.push(index); return BigInt(index * index); } };
        expect(scalarBuiltinArray(host, rootFunction(), [0])).toBeUndefined();
        expect(reads).toEqual([]);
        expect(scalarBuiltinArray(ownedArray([4n, 9n], [1, 2]), rootFunction(), [1, 0])).toBeUndefined();
    });

    it('preserves lazy sequence demand and the scalar native error contract', () => {
        expect(run('((0 to 4) isqrt) array')).toBe('0 1 1 1 2');
        expect(() => run('.NA isqrt')).toThrow('missing value where an integer is needed');
        expect(run('9223372036854775808 isqrt')).toBe('3037000499');
    });

    it('can cancel materialization and resume without a poisoned cache', () => {
        const { result } = mapped(Array.from({ length: 10000 }, (_, i) => BigInt(i)));
        const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 1 };
        expect(() => withInterrupt(signal, () => result.items)).toThrow(InterruptedError);
        expect(result.items).toHaveLength(10000);
        expect(result.itemAt!(9999)).toBe(99n);
    });

    it('cancels a stored pass using Atomics-only polling', () => {
        const { result } = mapped(Array.from({ length: 10000 }, (_, i) => BigInt(i)));
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => result.items)).toThrow(InterruptedError);
        expect(result.items).toHaveLength(10000);
    });

    it('observes source writes from arbitrary host polling', () => {
        const { source, result } = mapped(Array.from({ length: 10000 }, () => 4n));
        let changed = false;
        const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {}, exchange() {
            if (!changed) { source.items[9999] = 81n; changed = true; }
            return 0;
        } };
        expect(withInterrupt(signal, () => result.items).at(-1)).toBe(9n);
        expect(changed).toBe(true);
        expect(result.items.at(-1)).toBe(9n);
    });

    it('does not recognize copied or overridden native implementations by name', () => {
        const source = ownedArray([4n, 9n], [2]), fn = rootFunction();
        expect(scalarBuiltinArray(source, { ...fn }, [0])).toBeUndefined();
        Object.defineProperty(fn, 'call', { value: () => 7n });
        expect(scalarBuiltinArray(source, fn, [0])).toBeUndefined();
    });

    it('retains ordinary dispatch while inspecting', () => {
        const source = ownedArray([4n, 9n], [2]);
        const signal: InterruptSignal = { length: 2, load: () => 0, store() {}, wait() {}, exchange: () => 0 };
        expect(withInterrupt(signal, () => scalarBuiltinArray(source, rootFunction(), [0]), () => {})).toBeUndefined();
    });

    it('keeps source errors outside partially consumed prefixes', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use numbers\nuse sequences\nA = array 4 9 -1\nRoots = A isqrt');
            expect(runtime.execute('Roots 1')).toBe(3n);
            expect(() => runtime.execute('Roots 2')).toThrow('isqrt expects a nonnegative integer');
            const roots = runtime.variables.get('Roots');
            expect(isRankArray(roots!)).toBe(true);
        } finally { runtime.dispose(); }
    });
});
