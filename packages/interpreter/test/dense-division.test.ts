import { describe, expect, it } from 'vitest';
import { Interpreter, isNativeFunction, isRankArray, MISSING, type RankValue } from '../src/index.js';
import { denseScalarItems, ownedArray } from '../src/array-storage.js';
import { canApplySelectors } from '../src/value-selection.js';
import { isIntegerCollectionSelector } from '../src/selectors.js';
import { numericKernel } from '../src/numeric-kernels.js';
import { mapDenseArrays } from '../src/tensor.js';
import { checkpoint, InterruptedError, withInterrupt } from '../src/interrupt.js';

function withRuntime(check: (runtime: Interpreter) => void) {
    const runtime = new Interpreter();
    try { check(runtime); } finally { runtime.dispose(); }
}

for (const operator of ['//', 'mod']) describe(`dense ${operator}`, () => {
    it('keeps exact integer results and named intermediate arithmetic dense', () => withRuntime(runtime => {
        const samples = [0n, 1n, -1n, 7n, -7n, 2n ** 53n + 1n, -(2n ** 70n), 2n ** 100n + 3n];
        const values = Array.from({ length: 2048 }, (_, i) => samples[i % samples.length]);
        runtime.variables.set('A', ownedArray(values, [values.length], true));
        for (const divisor of [3n, -3n, 2n ** 60n + 1n]) {
            runtime.variables.set('B', divisor);
            const result = runtime.execute(`Q = A ${operator} B\nQ`)!;
            if (!isRankArray(result)) throw new Error('expected array');
            expect(denseScalarItems(result)).toBeDefined();
            expect(result.items).toEqual(values.map(a => {
                const remainder = a % divisor;
                const adjust = remainder !== 0n && (remainder < 0n) !== (divisor < 0n);
                return operator === '//' ? a / divisor - (adjust ? 1n : 0n)
                    : remainder + (adjust ? divisor : 0n);
            }));
            const chained = runtime.execute('Q * 3 + 1')!;
            if (!isRankArray(chained)) throw new Error('expected array');
            expect(denseScalarItems(chained)).toBeDefined();
        }
    }));

    it('broadcasts arrays and either scalar orientation like scalar evaluation', () => withRuntime(runtime => {
        runtime.execute('fun A B scalar\n  return A ' + operator + ' B\nend');
        const scalar = runtime.variables.get('scalar')!;
        if (!isNativeFunction(scalar)) throw new Error('expected function');
        const left = Array.from({ length: 2048 }, (_, i) => BigInt(i - 1024));
        const right = Array.from({ length: 2048 }, (_, i) => BigInt(i % 7 + 1));
        runtime.variables.set('A', ownedArray(left, [2048], true));
        runtime.variables.set('B', ownedArray(right, [2048], true));
        for (const expression of [`A ${operator} B`, `10 ${operator} B`, `A ${operator} -3`]) {
            const result = runtime.execute(expression)!;
            if (!isRankArray(result)) throw new Error('expected array');
            expect(denseScalarItems(result)).toBeDefined();
            expect(result.items).toEqual(left.map((a, i) => {
                return scalar.call([expression.startsWith('10') ? 10n : a,
                    expression.endsWith('-3') ? -3n : right[i]]);
            }));
        }
        runtime.execute('A = array shape 64 1 fill -7\nB = array shape 1 32 fill 3');
        const result = runtime.execute(`A ${operator} B`)!;
        if (!isRankArray(result)) throw new Error('expected array');
        expect(result.shape).toEqual([64, 32]);
        expect(result.items).toEqual(Array(2048).fill(operator === '//' ? -3n : 2n));
        expect(() => runtime.execute(`A ${operator} (array 1 2 3 4 5)`)).not.toThrow();
        expect(() => runtime.execute(`(array shape 64 2 fill 1) ${operator} (array 1 2 3)`))
            .toThrow('shape mismatch');
    }));

    it('defers a bad cell and lets choose skip it', () => withRuntime(runtime => {
        runtime.execute(`use sequences\nA = array shape 2048 fill 7\nB = array shape 2048 fill 3\nB 2047 = 0\nQ = A ${operator} B`);
        expect(runtime.execute('Q 0')).toBe(operator === '//' ? 2n : 1n);
        expect(() => runtime.execute('Q 2047')).toThrow('division by zero');
        const result = runtime.execute('Mask = B equal 0\nSafe = Mask choose 0 Q\nSafe sum');
        expect(result).toBe(BigInt(2047 * (operator === '//' ? 2 : 1)));
    }));

    it('leaves unsupported pairs to the scalar fallback', () => {
        const calls: RankValue[][] = [];
        const kernel = numericKernel(operator, (a, b) => { calls.push([a, b]); return 'fallback'; });
        for (const pair of [[1n, 0n], [1n, 0], [1, 2], [MISSING, 1n], [true, 1n]] as RankValue[][]) {
            expect(kernel(pair[0], pair[1])).toBe('fallback');
        }
        expect(calls).toHaveLength(5);
    });

    it('does not probe an unread host operand', () => withRuntime(runtime => {
        const reads: number[] = [];
        runtime.variables.set('Host', {
            kind: 'array', shape: [2048], containsFiles: false,
            itemAt(index: number) { reads.push(index); return index === 0 ? 7n : 0n; },
            get items(): RankValue[] { throw new Error('materialized host'); },
        });
        runtime.execute(`Q = 7 ${operator} Host`);
        expect(reads).toEqual([]);
        expect(runtime.execute('Q 0')).toBe(operator === '//' ? 1n : 0n);
        expect(reads).toEqual([0]);
        expect(() => runtime.execute('Q 1')).toThrow('division by zero');
        expect(reads).toEqual([0, 1]);
    }));

    it('keeps dense evaluation cancellable', () => {
        const source = ownedArray(Array(8192).fill(7n), [8192], true);
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        expect(() => withInterrupt(signal, () => {
            checkpoint('before array', 1023);
            return mapDenseArrays(source, 3n, numericKernel(operator, () => { throw new Error('fallback'); }));
        })).toThrow(InterruptedError);
    });

    it('retains value semantics and permits writes to the dense result', () => withRuntime(runtime => {
        runtime.execute(`A = array shape 2048 fill 7\nQ = A ${operator} 3\nAlias = Q\nA 0 = 100\nQ 1 = 100`);
        expect(runtime.execute('Q 0')).toBe(operator === '//' ? 2n : 1n);
        expect(runtime.execute('Alias 1')).toBe(operator === '//' ? 2n : 1n);
        expect(runtime.execute('Q 1')).toBe(100n);
    }));

    it('keeps small, empty, missing and real inputs on their valid paths', () => withRuntime(runtime => {
        expect(runtime.execute(`(array 7 -7) ${operator} 3 sum`)).toBe(operator === '//' ? -1n : 3n);
        const empty = runtime.execute(`(array shape 0 fill 0) ${operator} 0`)!;
        if (!isRankArray(empty)) throw new Error('expected array');
        expect(empty.items).toEqual([]);
        runtime.variables.set('Missing', MISSING);
        runtime.execute(`A = array shape 2048 fill 7\nQ = A ${operator} Missing`);
        expect(runtime.execute('Q 0')).toBe(MISSING);
        for (const [a, b] of [[-7.5, 3], [7.5, -3], [-0, 3], [Infinity, 3], [NaN, 3]]) {
            runtime.variables.set('A', ownedArray(Array<RankValue>(2048).fill(a), [2048], true));
            runtime.variables.set('B', b);
            const scalar = runtime.execute(`X = A 0\nX ${operator} B`);
            const result = runtime.execute(`A ${operator} B`)!;
            if (!isRankArray(result)) throw new Error('expected array');
            expect(result.items[0]).toBe(scalar);
        }
    }));
});

it('retains host selector getter and custom every behavior', () => {
    let reads = 0;
    const selector = {
        kind: 'array' as const, shape: [2],
        get items() { reads++; return [1n, 2n]; },
    };
    expect(canApplySelectors([ownedArray([1n, 2n, 3n]), selector])).toBe(true);
    expect(reads).toBe(3);
    const values = [1n, 2n];
    Object.defineProperty(values, 'every', { value: () => false });
    expect(isIntegerCollectionSelector({ kind: 'array', shape: [2], items: values })).toBe(false);
});
