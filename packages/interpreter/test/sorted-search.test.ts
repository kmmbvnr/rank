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

    it('searches stored Int32 cells, edges outside Int32 and edits between searches', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use algo\nuse sequences\nA = ((1 to 3000) * 3) copy\n');
            const count = (op: string, t: string) => runtime.execute(`A ${op} ${t}`);
            expect(count('lowerindex', '9')).toBe(2n);
            expect(count('upperindex', '9')).toBe(3n);
            expect(count('upperindex', '10')).toBe(3n);
            expect(count('lowerindex', '(0 - 5000000000)')).toBe(0n);
            expect(count('upperindex', '5000000000')).toBe(3000n);
            expect(count('lowerindex', '2147483648')).toBe(3000n);
            expect(count('lowerindex', '(0 - 2147483649)')).toBe(0n);
            expect(formatValue(runtime.execute('A lowerindex (array 0 3 4 9000 9001)')!)).toBe('0 0 1 2999 3000');
            expect(count('upperindex', '9000')).toBe(3000n);
            runtime.execute('A 2999 = 100000');
            expect(count('upperindex', '9000')).toBe(2999n);
            expect(count('lowerindex', '99999')).toBe(2999n);
            expect(count('upperindex', '100000')).toBe(3000n);
        } finally { runtime.dispose(); }
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

describe('sorted index batches', () => {
    const run = (source: string): string => {
        const runtime = new Interpreter();
        try { return formatValue(runtime.execute('use sequences\nuse numbers\nuse algo\n' + source)!); } finally { runtime.dispose(); }
    };
    const ref = (cells: bigint[], target: bigint, upper: boolean) => cells.filter(c => c < target || upper && c === target).length;

    it('matches single searches for unordered, repeated and extreme targets', () => {
        for (const scale of [1n, 4_000_000_000n]) {
            const cells = Array.from({ length: 3000 }, (_, i) => (BigInt(i) * 3n + BigInt(i % 2)) * scale);
            const mid = Array.from({ length: 5000 }, (_, i) => (BigInt((i * 7919) % 9500) - 200n) * scale);
            const setup = `Dk = (((0 to 2999) * 3 + (0 to 2999) mod 2) * ${scale}) copy\n`
                + `Tm = ((((0 to 4999) * 7919 mod 9500) - 200) * ${scale}) copy\n`
                + `Tw = concat Tm ((array shape 1 fill 0) - 5000000000)\nTw = concat Tw (array shape 1 fill 5000000000)\n`;
            const targets = [...mid, -5_000_000_000n, 5_000_000_000n];
            for (const upper of [false, true]) {
                const op = upper ? 'upperindex' : 'lowerindex';
                const got = run(`${setup}Rs = Dk ${op} Tw\nRs`).split(' ').map(BigInt);
                expect(got).toEqual(targets.map(t => BigInt(ref(cells, t, upper))));
            }
        }
    });
    it('keeps sorted targets and edits between batches exact', () => {
        const out = run('Dk = ((1 to 4000) * 2) copy\nTv = (1 to 4000) copy\nA1 = Dk lowerindex Tv\nDk 3999 = 100000\nA2 = Dk upperindex (Tv * 2)\nS1 = A1 sum\nS2 = A2 sum\nS1 + S2');
        let a1 = 0, a2 = 0;
        const dk = Array.from({ length: 4000 }, (_, i) => (i + 1) * 2); 
        for (let t = 1; t <= 4000; t++) a1 += dk.filter(c => c < t).length;
        dk[3999] = 100000;
        for (let t = 1; t <= 4000; t++) a2 += dk.filter(c => c <= t * 2).length;
        expect(out).toBe(String(a1 + a2));
    });
});

describe('Int32 index vector gathers', () => {
    const exec = (source: string): string => {
        const runtime = new Interpreter();
        try { return formatValue(runtime.execute('use sequences\nuse numbers\n' + source)!); } catch (error) { return (error as Error).message; } finally { runtime.dispose(); }
    };
    const base = 'Dk = ((1 to 5000) * 2) copy\n';
    it('gathers sorted, repeated and shuffled in-range vectors', () => {
        expect(exec(`${base}Ix = (((0 to 4999) * 7) mod 5000) copy\nRs = Dk Ix\nRs sum`)).toBe(String([...Array(5000).keys()].reduce((n, i) => n + ((i * 7) % 5000 + 1) * 2, 0)));
        expect(exec(`${base}Ix = ((0 to 4999) // 2) copy\nRs = Dk Ix\nRs sum`)).toBe(String([...Array(5000).keys()].reduce((n, i) => n + (Math.floor(i / 2) + 1) * 2, 0)));
    });
    it('reports the first offending index', () => {
        expect(exec(`${base}Ix = ((0 to 4999) - 3) copy\nRs = Dk Ix\nRs sum`)).toContain('nonnegative');
        expect(exec(`${base}Ix = ((0 to 4999) + 3) copy\nRs = Dk Ix\nRs sum`)).toContain('out of bounds on axis 0: 5000');
    });
});
