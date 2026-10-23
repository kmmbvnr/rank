import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction, type RankArray } from '../src/index.js';
import { ownedArray } from '../src/array-storage.js';
import { sortedIndex } from '../src/sorted-search.js';
import { withInterrupt, type InterruptSignal } from '../src/interrupt.js';

describe('sorted integer insertion indices', () => {
    it('matches independent linear counts for duplicates, gaps, empty arrays and huge integers', () => {
        const huge = 10n ** 100n;
        for (const items of [[], [3n], [-huge, -4n, 0n, 3n, 3n, huge]]) {
            for (const target of [-huge - 1n, -huge, -3n, 0n, 2n, 3n, 4n, huge, huge + 1n]) {
                const source = ownedArray(items);
                expect(sortedIndex(source, target, false)).toBe(BigInt(items.filter(x => x < target).length));
                expect(sortedIndex(source, target, true)).toBe(BigInt(items.filter(x => x <= target).length));
            }
        }
    });

    it.each([false, true])('supports scalar and ranked targets with compilation=%s', compilation => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use algo\nuse sequences\nA = array 1 3 3 7\nQ = (array 0 3 7 8) reshape 2 2');
            expect(formatValue(runtime.execute('A lowerindex Q')!)).toBe('0 1 3 4');
            expect(formatValue(runtime.execute('A upperindex Q')!)).toBe('0 3 4 4');
            expect(runtime.execute('(A upperindex 3) - (A lowerindex 3)')).toBe(2n);
            runtime.execute('A 3 = 9');
            expect(runtime.execute('A upperindex 8')).toBe(3n);
            expect(runtime.execute('A upperindex 3 rank 1 0')).toBe(3n);
        } finally { runtime.dispose(); }
    });

    it('keeps insertion searches in compiled functions and loops and respects overrides', () => {
        let functions = 0, loops = 0;
        const runtime = new Interpreter(undefined, {
            onScalarFunctionExecuted: () => functions++, onIntegerLoopExecuted: () => loops++,
        });
        try {
            runtime.execute('use algo\nA = array 1 3 3 7\nfun A bounds X\nreturn (A upperindex X) - (A lowerindex X)\nend');
            expect(runtime.execute('A bounds 3')).toBe(2n);
            expect(functions).toBeGreaterThan(0);
            expect(runtime.execute('Total = 0\nfor X in 0 to 9\nTotal += A upperindex X\nend\nTotal')).toBe(26n);
            expect(loops).toBeGreaterThan(0);
            runtime.execute('fun A replacement X = 42\nf = replacement');
            runtime.variables.set('upperindex', runtime.variables.get('f')!);
            expect(runtime.execute('A bounds 3')).toBe(41n);
            expect(runtime.execute('Total = 0\nfor X in 0 to 9\nTotal += A upperindex X\nend\nTotal')).toBe(420n);
        } finally { runtime.dispose(); }
    });

    it('reads logarithmically without materializing a lazy vector', () => {
        let reads = 0;
        const length = 2 ** 30;
        const source: RankArray = { kind: 'array', shape: [length], items: [], itemAt(i) { reads++; return BigInt(i * 2); } };
        expect(sortedIndex(source, 17n, false)).toBe(9n);
        expect(reads).toBeLessThanOrEqual(31);
        reads = 0;
        expect(sortedIndex(source, 18n, true)).toBe(10n);
        expect(reads).toBeLessThanOrEqual(31);
    });

    it('supports views and leaves multiset bounds unchanged', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use algo\nuse sequences\nA = array 1 2 3 4 5 6');
            expect(runtime.execute('(A (1 to 4)) upperindex 3')).toBe(2n);
            expect(runtime.execute('Bag = (array 1 3 3 7) multiset\nBag lowerbound 3')).toBe(3n);
            expect(runtime.execute('Bag upperbound 3')).toBe(7n);
        } finally { runtime.dispose(); }
    });

    it('rejects non-vectors, noninteger targets and visited noninteger cells', () => {
        for (const source of [1n, ownedArray([1n, 2n], [1, 2]), ownedArray([1.5])]) {
            expect(() => sortedIndex(source, 1n, false)).toThrow('sorted integer vector');
        }
        expect(() => sortedIndex(ownedArray([1n]), 1, true)).toThrow('integer target');
    });

    it('propagates cell errors and supports cancellation', () => {
        const source: RankArray = { kind: 'array', shape: [1], items: [], itemAt() { throw Error('cell error'); } };
        expect(() => sortedIndex(source, 1n, false)).toThrow('cell error');
        const cancel: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {}, exchange: () => 1 };
        const runtime = new Interpreter();
        try {
            runtime.execute('use algo\nf = upperindex');
            const operation = runtime.variables.get('f')!;
            expect(isNativeFunction(operation)).toBe(true);
            if (isNativeFunction(operation)) {
                expect(() => withInterrupt(cancel, () => operation.call([ownedArray([1n]), 1n])))
                    .toThrow('Interrupted');
            }
        } finally { runtime.dispose(); }
    });
});
