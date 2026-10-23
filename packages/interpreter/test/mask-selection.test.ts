import { describe, expect, it } from 'vitest';
import { Interpreter, MISSING, RuntimeDiagnostics, formatValue, type RankArray } from '../src/index.js';
import { arrayForWrite, noteArrayBinding, ownedArray } from '../src/array-storage.js';
import { collectionSize } from '../src/collection-size.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { sliceSource } from '../src/slice-source.js';
import { maskSelection } from '../src/value-selection.js';

describe('array mask selection plans', () => {
    it('counts positions once without reading source cells', () => {
        const flags = [false, true, false, true];
        let maskReads = 0;
        const mask: RankArray = { kind: 'array', shape: [4], items: new Proxy(flags, {
            get(target, key, receiver) {
                if (typeof key === 'string' && /^\d+$/.test(key)) maskReads++;
                return Reflect.get(target, key, receiver);
            },
        }) };
        const reads: number[] = [];
        const source: RankArray = { kind: 'array', shape: [4], items: [],
            itemAt: index => { reads.push(index); return BigInt(index); } };
        const selected = maskSelection(source, mask);
        expect(selected.plan.size).toEqual({ kind: 'exact', value: 2n });
        expect(maskReads).toBe(4);
        expect(collectionSize(selected)!.length()).toBe(2n);
        const dropped = sliceSource(selected)!.slice(1n, true);
        const taken = sliceSource(selected)!.slice(1n, false);
        expect(collectionSize(dropped)!.length()).toBe(1n);
        expect(collectionSize(taken)!.length()).toBe(1n);
        expect(reads).toEqual([]);
        expect([...selected.plan.iterate()]).toEqual([1n, 3n]);
        expect([...selected.plan.iterate()]).toEqual([1n, 3n]);
        expect(reads).toEqual([1, 3, 1, 3]);
        expect(maskReads).toBe(4);
    });

    it.each([[], [false, false], [true, true], [MISSING, true]].map(flags => ({ flags })))('keeps exact sizes for $flags', ({ flags }) => {
        const expected = flags.flatMap((flag, index) => flag === true ? [BigInt(index)] : []);
        const selected = maskSelection(ownedArray(flags.map((_, index) => BigInt(index))), ownedArray(flags));
        expect(selected.kind).toBe('sequence');
        expect(selected.plan.size).toEqual({ kind: 'exact', value: BigInt(expected.length) });
        expect([...selected.plan.iterate()]).toEqual(expected);
    });

    it('keeps row-major atom selection and existing validation errors', () => {
        const source = ownedArray([1n, 2n, 3n, 4n], [2, 2]);
        const selected = maskSelection(source, ownedArray([true, false, false, true], [2, 2]));
        expect([...selected.plan.iterate()]).toEqual([1n, 4n]);
        expect(() => maskSelection(source, ownedArray([true, false, false, true])))
            .toThrow('mask shape mismatch');
        expect(() => maskSelection(ownedArray([1n]), ownedArray([0n])))
            .toThrow('array selector must be a boolean mask');
    });

    it('validates lazy selector cells before reporting a mask shape mismatch', () => {
        const source = ownedArray([1n, 2n, 3n]);
        const reads: number[] = [];
        const selector: RankArray = { kind: 'array', shape: [2], items: [],
            itemAt: index => { reads.push(index); return 1.0; } };
        expect(() => maskSelection(source, selector))
            .toThrow('index array has real elements');
        expect(reads).toEqual([0]);
    });

    it('reads lazy boolean masks with missing cells without demanding the source', () => {
        const source: RankArray = { kind: 'array', shape: [3], items: [],
            itemAt: () => { throw new Error('source cell'); } };
        const reads: number[] = [];
        const selector: RankArray = { kind: 'array', shape: [3], items: [],
            itemAt: index => { reads.push(index); return [true, MISSING, false][index]; } };
        const selected = maskSelection(source, selector);
        expect(reads).toEqual([0, 1, 2]);
        expect(collectionSize(selected)!.length()).toBe(1n);
        expect(() => [...selected.plan.iterate()]).toThrow('source cell');
    });

    it('rejects mixed boolean and real selectors before checking shape', () => {
        expect(() => maskSelection(ownedArray([1n, 2n, 3n]), { kind: 'array', shape: [2], items: [true, 1.0] }))
            .toThrow('index array has real elements');
    });

    it('does not demand a throwing selected cell for len', () => {
        const source: RankArray = { kind: 'array', shape: [1], items: [],
            itemAt: () => { throw new Error('selected cell'); } };
        const selected = maskSelection(source, ownedArray([true]));
        expect(collectionSize(selected)!.length()).toBe(1n);
        expect(() => [...selected.plan.iterate()]).toThrow('selected cell');
    });

    it('retains the source without eagerly copying it', () => {
        const source = ownedArray([1n, 2n, 3n]);
        noteArrayBinding(source);
        const diagnostics = new RuntimeDiagnostics();
        const selected = diagnostics.run(() => maskSelection(source, ownedArray([false, true, true])));
        expect(diagnostics.cowCopies).toBe(0);
        const writable = diagnostics.run(() => arrayForWrite(source));
        expect(writable).toBeDefined();
        writable!.items[1] = 9n;
        expect([...selected.plan.iterate()]).toEqual([2n, 3n]);
        expect(diagnostics.cowCopies).toBe(1);
    });

    it('can cancel position collection even when no cells are kept', () => {
        const mask = ownedArray(Array(4096).fill(false));
        const source = ownedArray(Array(4096).fill(1n));
        const signal = new Int32Array(new SharedArrayBuffer(4));
        signal[0] = 1;
        expect(() => withInterrupt(signal, () => maskSelection(source, mask))).toThrow(InterruptedError);
    });
});

for (const compilation of [false, true]) describe(`selection snapshots (compiled=${compilation})`, () => {
    const run = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation });
        try { return formatValue(runtime.execute('use sequences\n' + source)!); }
        finally { runtime.dispose(); }
    };

    it('keeps selected positions and derived sizes after a materialized mask write', () => {
        expect(run(`N = array 1 2 3
M = array false true true
S = N filter M
D = S drop 1
Before = S len
M 1 = false
tuple Before (S len) (D len) (S array) (M copy)`)).toBe('2 2 1 2 3 false false true');
    });

    it('preserves the source through COW on later scalar and compiled loop writes', () => {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use sequences\nN = array 1 2 3\nM = array false true true\nS = N filter M');
            diagnostics.run(() => runtime.execute('for I in 0 till 3\n N I = 9\nend'));
            expect(formatValue(runtime.execute('tuple (S array) N')!)).toBe('2 3 9 9 9');
            expect(diagnostics.cowCopies).toBe(1);
        } finally { runtime.dispose(); }
    });

    it('preserves a source slice when its backing array is written', () => {
        expect(run(`N = array 1 2 3 4
Later = N drop 1
M = array true false true
S = Later filter M
N 1 = 9
S`)).toBe('2 4');
    });

    it('completes ordinary masks and keeps explicit mask plans read-only', () => {
        expect(run('N = array 1 2 3\nM = N greater 1\nM 1 = false\nM'))
            .toBe('false false true');
        expect(() => run("N = array 1 2 3\nM' = N greater 1\nM 1 = false"))
            .toThrow('array assignment expects an array target');
        expect(run('N = array 1 2 3\nM = N greater 1\nS = N filter M\nM and= N less 3\nS'))
            .toBe('2 3');
        expect(run('N = array 1 2 3\nM = (N greater 1) copy\nS = N filter M\nM 1 = false\nS'))
            .toBe('2 3');
    });

    it('snapshots an array mask applied to a sequence too', () => {
        expect(run('N = 1 to 3\nM = array false true true\nS = N filter M\nM 1 = false\nS'))
            .toBe('2 3');
    });

    it('copies a retained sequence mask only on a later write', () => {
        const runtime = new Interpreter(undefined, { compilation });
        const diagnostics = new RuntimeDiagnostics();
        try {
            diagnostics.run(() => runtime.execute("use sequences\nN' = 1 to 3\nM = array false true true\nAlias = M\nS' = N filter M"));
            expect(diagnostics.cowCopies).toBe(0);
            expect(() => runtime.execute('M 0 = false')).toThrow(/read-only/);
            diagnostics.run(() => runtime.execute('for I in 0 till 3\n Alias I = false\nend'));
            expect(formatValue(runtime.execute('S')!)).toBe('2 3');
            expect(diagnostics.cowCopies).toBe(1);
        } finally { runtime.dispose(); }
    });
});

for (const compilation of [false, true]) describe(`real index diagnostics (compiled=${compilation})`, () => {
    const run = (source: string) => {
        const runtime = new Interpreter(undefined, { compilation });
        try { return formatValue(runtime.execute(source)!); }
        finally { runtime.dispose(); }
    };

    it.each([
        'array 1.0 2.0',
        'array 1.5 2.5',
        'array 1.0 2.0 0.0 1.0',
        '(array 1.5 2.5) * 0 + 1',
    ])('names the real element type for %s', selector => {
        expect(() => run(`F = array 10 20 30 40\nI = ${selector}\nF I`))
            .toThrow(expect.objectContaining({
                rankKind: 'TypeError',
                message: 'index array has real elements; convert with integer or floor',
            }));
    });

    it('keeps integer gathers and explicit conversions', () => {
        expect(run('F = array 10 20 30 40\nF (array 1 2)')).toBe('20 30');
        expect(run('use numbers\nF = array 10 20 30 40\nI = (array 1.5 2.5) * 0 + 1\nF (I integer)'))
            .toBe('20 20');
        expect(run('use numbers\nF = array 10 20 30 40\nF ((array 1.5 2.5) floor)'))
            .toBe('20 30');
        expect(run('F = array 10 20 30 40\nI = array shape 0 fill 0\nF I')).toBe('');
    });

    it('keeps boolean selection and mask shape errors', () => {
        expect(run('F = array 1 2 3 4\nF (array false true true false)'))
            .toBe('2 3');
        expect(() => run('F = array 1 2 3 4\nF (array false true)'))
            .toThrow('mask length 2 does not match axis 0 size 4');
    });
});
