import { describe, expect, it, vi } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, isRankArray, withDemandBudget, DemandBudgetExhausted } from '../src/index.js';
import { derivedArray, materializedArrayItems, maskedArray, ownedArray, readArrayItem } from '../src/array-storage.js';
import { reshapeWithDimensions } from '../src/modules/sequences.js';
import type { RankArray } from '../src/value.js';

describe.each([false, true])('reshape views (compilation=%s)', compilation => {
    it('observes shapes without reading cells and reads only selected indices on each demand', () => {
        const reads: number[] = [];
        const input: RankArray = { kind: 'array', shape: [4], items: [],
            itemAt: i => { reads.push(i); return BigInt(i + 1); } };
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', input);
            r.execute("use sequences\nShaped' = Input reshape 2 2\nAgain' = Shaped reshape 4");
            expect(r.execute('Shaped len')).toBe(2n);
            expect(r.execute('Again len')).toBe(4n);
            expect(reads).toEqual([]);
            expect(r.execute('Shaped 0 1')).toBe(2n);
            expect(r.execute('Again 1')).toBe(2n);
            expect(reads).toEqual([1, 1]);
        } finally { r.dispose(); }
    });

    it.each(['Shaped', 'Shaped copy'])('completes %s at ordinary assignment and keeps independent writes', expression => {
        const reads: number[] = [];
        const input: RankArray = { kind: 'array', shape: [4], items: [],
            itemAt: i => { reads.push(i); return BigInt(i + 1); } };
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', input);
            r.execute(`use sequences\nShaped' = Input reshape 2 2\nSaved = ${expression}\nOld = Saved\nSaved 0 0 = 99`);
            expect(reads).toEqual([0, 1, 2, 3]);
            expect(r.execute('Saved sum')).toBe(108n);
            expect(r.execute('Old sum')).toBe(10n);
            expect(reads).toEqual([0, 1, 2, 3]);
            expect(r.execute('Shaped sum')).toBe(10n);
            expect(reads).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
        } finally { r.dispose(); }
    });

    it('completes at an ordinary parameter while a deferred parameter can inspect only the shape', () => {
        const reads: number[] = [];
        const input: RankArray = { kind: 'array', shape: [4], items: [],
            itemAt: i => { reads.push(i); return BigInt(i + 1); } };
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', input);
            r.execute("use sequences\nfun X length = X len\nfun X' lazy_length = X len\nView' = Input reshape 2 2");
            expect(r.execute('View lazy_length')).toBe(2n);
            expect(reads).toEqual([]);
            expect(r.execute('View length')).toBe(2n);
            expect(reads).toEqual([0, 1, 2, 3]);
        } finally { r.dispose(); }
    });

    it('checks incompatible shapes before reading a failing cell and defers cell errors until demand', () => {
        const reads: number[] = [];
        const input = derivedArray([4], [], i => {
            reads.push(i);
            if (i === 3) throw new RankError('last cell failed');
            return BigInt(i + 1);
        });
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', input);
            r.execute("use sequences\nShaped' = Input reshape 2 2\nSaved = (array 7 7 7 7) reshape 2 2");
            expect(() => r.execute('(Input reshape 3 2) len')).toThrow('expects 6 elements, got 4');
            expect(reads).toEqual([]);
            expect(r.execute('Shaped 0 0')).toBe(1n);
            expect(reads).toEqual([0]);
            expect(() => r.execute('Saved = Shaped')).toThrow('last cell failed');
            expect(reads).toEqual([0, 0, 1, 2, 3]);
            expect(r.execute('Saved sum')).toBe(28n);
        } finally { r.dispose(); }
    });

    it('short circuits before an unread failing branch after concat and reshape', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.execute(`use sequences
Input = array 1 2
Zero = array 0 0
Good' = Input greater 0
Bad' = (Input mod Zero) equal 0
Joined' = concat Good Bad
Shaped' = Joined reshape 2 2`);
            expect(r.execute('Shaped any')).toBe(true);
            expect(() => r.execute('Saved = Shaped')).toThrow('division by zero');
            expect(r.variables.has('Saved')).toBe(false);
        } finally { r.dispose(); }
    });

    it('fuses concat, repeated reshapes and transpose into the final consumer', () => {
        let entries = 0;
        const r = new Interpreter(undefined, { compilation, onTensorKernelExecuted: () => entries++ });
        const diagnostics = new RuntimeDiagnostics();
        try {
            r.variables.set('Input', ownedArray([1n, 2n, 3n, 4n], [2, 2]));
            r.execute(`use sequences
Left' = Input * 2
Joined' = concat Left Input axis 1
Flat' = Joined reshape 8
Shaped' = Flat reshape 4 2
View' = Shaped transpose`);
            expect(entries).toBe(0);
            expect(diagnostics.run(() => r.execute('View sum'))).toBe(30n);
            expect(entries).toBe(compilation ? 1 : 0);
            if (compilation) expect(diagnostics.cellsComputed).toBe(0);
            expect(r.execute('Saved = View\nSaved 0 0 = 100\nSaved sum')).toBe(128n);
            expect(r.execute('View sum')).toBe(30n);
        } finally { r.dispose(); }
    });

    it.each([undefined, 0n, -7n, 1n << 100n])('fuses integer prefix sums with seed %s without completing the source', seed => {
        let entries = 0;
        const r = new Interpreter(undefined, { compilation, onTensorKernelExecuted: () => entries++ });
        const diagnostics = new RuntimeDiagnostics();
        try {
            const values = [1n << 63n, -(1n << 64n), 3n, 9n];
            r.variables.set('Input', ownedArray(values, [2, 2]));
            r.execute("use sequences\nScaled' = Input * 2\nFlat' = Scaled reshape 4");
            const actual = diagnostics.run(() => r.execute(`Saved = Flat scan + ${seed === undefined ? '' : `with (${seed})`}`));
            if (!isRankArray(actual!)) throw Error('expected prefix array');
            let sum = seed;
            const expected = seed === undefined ? [] : [seed];
            for (const value of values) { sum = sum === undefined ? value * 2n : sum + value * 2n; expected.push(sum); }
            expect(actual.shape).toEqual([expected.length]);
            expect(expected.map((_, i) => readArrayItem(actual, i))).toEqual(expected);
            expect(entries).toBe(compilation ? 1 : 0);
            if (compilation) expect(diagnostics.cellsComputed).toBe(0);
            expect(r.execute('Again = Flat scan + with 1\nAgain 0')).toBe(1n);
        } finally { r.dispose(); }
    });

    it('keeps empty scan identities, real seeds and named callbacks on their ordinary contracts', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            expect(r.execute("use sequences\nEmpty = array shape 0 fill 0\nFlat' = (Empty + 1) reshape 0\nSaved = Flat scan + with 7\nSaved 0")).toBe(7n);
            expect(r.execute('Saved len')).toBe(1n);
            expect(r.execute('(Flat scan +) len')).toBe(0n);
            expect(r.execute("Input = array 1.0 2.0\nReal' = Input reshape 2\n(Real scan + with 0.5) sum")).toBe(5.5);
            expect(r.execute("fun A difference B = A - B\nInts = array 1 2 3\nView' = (Ints * 2) reshape 3\n(View scan difference with 10) sum")).toBe(20n);
        } finally { r.dispose(); }
    });

    it('keeps scan cell errors and retries without a cached result', () => {
        const reads: number[] = [];
        const input: RankArray = { kind: 'array', shape: [3], items: [], itemAt: i => {
            reads.push(i);
            if (i === 1) throw new RankError('second cell failed');
            return BigInt(i + 1);
        } };
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', input);
            r.execute("use sequences\nFlat' = (Input * 2) reshape 3");
            for (let attempt = 0; attempt < 2; attempt++) {
                expect(() => r.execute('Saved = Flat scan + with 0')).toThrow('second cell failed');
                expect(r.variables.has('Saved')).toBe(false);
            }
            expect(reads).toEqual([0, 1, 0, 1]);
        } finally { r.dispose(); }
    });

    it('retains missing cells through reshape and ordinary completion', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', maskedArray(new BigInt64Array([1n, 0n, 3n, 4n]), new Uint32Array([13])));
            r.execute("use sequences\nView' = Input reshape 2 2\nSaved = View");
            expect(r.execute('Saved 0 0')).toBe(1n);
            expect(r.execute('(Saved 0 1) default 99')).toBe(99n);
            expect(r.execute('(View 0 1) default 99')).toBe(99n);
        } finally { r.dispose(); }
    });

    it('retains callbacks producing empty cells when completing a reshaped view', () => {
        const output: string[] = [];
        const r = new Interpreter(line => output.push(line), { compilation });
        try {
            r.execute(`use sequences
use io
fun X empty rank 0
 X print
 return array shape 0 fill 0
end
Rows' = (array 1 2) empty rank 0
Flat' = Rows reshape 0`);
            expect(output).toEqual([]);
            r.execute('Saved = Flat');
            expect(output).toEqual(['1', '2']);
            expect(r.execute('Saved len')).toBe(0n);
            r.execute('Saved = Flat');
            expect(output).toEqual(['1', '2', '1', '2']);
        } finally { r.dispose(); }
    });

    it('respects a demand budget after scan code has been cached and permits retry', () => {
        const r = new Interpreter(undefined, { compilation });
        try {
            r.variables.set('Input', ownedArray(Array.from({ length: 16384 }, () => 1n)));
            r.execute("use sequences\nFlat' = (Input * 2) reshape 16384");
            expect(r.execute('(Flat scan + with 0) last')).toBe(32768n);
            expect(() => withDemandBudget(100, () => r.execute('(Flat scan + with 0) last'))).toThrow(DemandBudgetExhausted);
            expect(r.execute('(Flat scan + with 0) last')).toBe(32768n);
        } finally { r.dispose(); }
    });
});

it('does not materialize computed cells while constructing or reshaping a view', () => {
    const reads: number[] = [];
    const input = derivedArray([2, 2], [], i => { reads.push(i); return BigInt(i); });
    const shaped = reshapeWithDimensions(input, [4n]);
    if (!isRankArray(shaped)) throw Error('expected array');
    const again = reshapeWithDimensions(shaped, [1n, 4n]);
    if (!isRankArray(again)) throw Error('expected array');
    expect(materializedArrayItems(shaped)).toBeUndefined();
    expect(reads).toEqual([]);
    expect(readArrayItem(again, 2)).toBe(2n);
    expect(reads).toEqual([2]);
});

it('retains ordinary reshape and scan execution without dynamic code generation', () => {
    const mock = vi.spyOn(globalThis, 'Function').mockImplementation(() => { throw Error('CSP'); });
    const r = new Interpreter();
    try {
        expect(r.execute("use sequences\nInput = array 1 2 3 4\nFlat' = (Input * 2) reshape 4\n(Flat scan + with 0) sum")).toBe(40n);
    } finally { r.dispose(); mock.mockRestore(); }
});
