import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, MISSING, type RankArray } from '../src/index.js';
import { allPresent, maskedArray, ownedArray, readArrayItem, typedArray, writeArrayCell } from '../src/array-storage.js';
import { maskSelection, materializeMaskSelection } from '../src/array-mask-selection.js';
import { materializeSequence } from '../src/sequence.js';
import { registerScalarView } from '../src/integer-view.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';

const cells = (value: RankArray) => Array.from({ length: value.shape[0] }, (_, i) => readArrayItem(value, i));

describe('stored mask materialization', () => {
    it.each([[], [false, false], [true, true], [false, true]].map(flags => ({ flags })))('compacts $flags', ({ flags }) => {
        const values = flags.map((_, i) => (1n << 100n) + BigInt(i));
        const selected = maskSelection(ownedArray(values), ownedArray(flags));
        expect(cells(materializeSequence(selected))).toEqual(values.filter((_, i) => flags[i]));
    });

    it.each(['integer', 'real'] as const)('reads %s typed storage exactly', kind => {
        const source = typedArray(kind === 'integer' ? new BigInt64Array([-9223372036854775808n, 9223372036854775807n])
            : new Float64Array([1.25, Infinity]));
        expect(cells(materializeSequence(maskSelection(source, ownedArray([true, true])))))
            .toEqual(kind === 'integer' ? [-9223372036854775808n, 9223372036854775807n] : [1.25, Infinity]);
    });

    it.each(['int32', 'int64', 'real'] as const)('gathers strided %s storage without aliasing', kind => {
        const source = typedArray(kind === 'int32' ? new Int32Array([-2147483648, 7, 0, 9, 2147483647])
            : kind === 'int64' ? new BigInt64Array([-(1n << 63n), 7n, 0n, 9n, (1n << 63n) - 1n])
            : new Float64Array([-1.25, 7, -0, 9, 1.75]));
        const view: RankArray = { kind: 'array', shape: [3], items: [], itemAt: i => readArrayItem(source, 4 - 2 * i) };
        registerScalarView(view, source, i => 4 - 2 * i, { linear: () => ({ offset: 4, stride: -2 }) });
        const result = materializeSequence(maskSelection(view, ownedArray([true, true, true])));
        expect(cells(result)).toEqual([readArrayItem(source, 4), readArrayItem(source, 2), readArrayItem(source, 0)]);
        writeArrayCell(result, 0, kind === 'real' ? 1.5 : 42n);
        expect(readArrayItem(source, 4)).toEqual(kind === 'real' ? 1.75 : kind === 'int64' ? (1n << 63n) - 1n : 2147483647n);
        writeArrayCell(source, 0, kind === 'real' ? 2.5 : 43n);
        expect(readArrayItem(result, 2)).toEqual(kind === 'real' ? -1.25 : kind === 'int64' ? -(1n << 63n) : -2147483648n);
    });

    it('keeps empty typed selections free of binding checks', () => {
        const source = typedArray(new Int32Array([1, 2]));
        const view: RankArray = { kind: 'array', shape: [2], items: [], itemAt: () => { throw Error('binding'); } };
        registerScalarView(view, source, i => i, { linear: () => ({ offset: 0, stride: 1 }), scalarCheck: true,
            check: () => { throw Error('binding'); } });
        expect(cells(materializeSequence(maskSelection(view, ownedArray([false, false]))))).toEqual([]);
        expect(() => materializeSequence(maskSelection(view, ownedArray([false, true])))).toThrow('binding');
    });

    it('constructs independent selection snapshots from the current mask', () => {
        const source = ownedArray([1n, 2n, 3n]), mask = ownedArray([false, true, true]);
        const first = maskSelection(source, mask);
        const second = maskSelection(source, mask);
        mask.items[1] = false;
        const third = maskSelection(source, mask);
        expect(cells(materializeSequence(first))).toEqual([2n, 3n]);
        expect(cells(materializeSequence(second))).toEqual([2n, 3n]);
        expect(cells(materializeSequence(third))).toEqual([3n]);
    });

    it('does not reuse positions after a mask changes to an invalid scalar kind', () => {
        const source = ownedArray([1n,2n]), mask = ownedArray([true,false]);
        maskSelection(source,mask);
        mask.items[1] = 0n;
        expect(() => maskSelection(source,mask)).toThrow('boolean mask');
    });

    it('retains missing mask cells and validates rejected masks before reading source', () => {
        let reads = 0;
        const source: RankArray = { kind: 'array', shape: [3], items: [], itemAt: i => { reads++; return BigInt(i); } };
        const selected = maskSelection(source,ownedArray([true,MISSING,false]));
        expect(reads).toBe(0);
        expect(cells(materializeSequence(selected))).toEqual([0n]);
        expect(reads).toBe(1);
        expect(() => maskSelection(source,{kind: 'array', shape: [3], items: [true,false,0n]})).toThrow('boolean mask');
        expect(reads).toBe(1);
    });

    it('declines missing and nested sources and leaves their normal stacking intact', () => {
        const validity = allPresent(2); validity[0] &= ~1;
        const source = maskedArray(new BigInt64Array([0n, 7n]), validity);
        const selected = maskSelection(source, ownedArray([true, true]));
        expect(materializeMaskSelection(selected)).toBeUndefined();
        expect(cells(materializeSequence(selected))).toEqual([MISSING, 7n]);
        const nested = maskSelection(ownedArray([ownedArray([1n, 2n]), ownedArray([3n, 4n])]), ownedArray([false, true]));
        expect(materializeMaskSelection(nested)).toBeUndefined();
        expect(formatValue(materializeSequence(nested))).toBe('3 4');
    });

    it('does not probe host getters or unselected throwing lazy cells', () => {
        const reads: number[] = [];
        const source: RankArray = { kind: 'array', shape: [2], items: [], itemAt: i => {
            reads.push(i); if (!i) throw new Error('unselected'); return 7n;
        } };
        const selected = maskSelection(source, ownedArray([false, true]));
        expect(materializeMaskSelection(selected)).toBeUndefined();
        expect(reads).toEqual([]);
        expect(cells(materializeSequence(selected))).toEqual([7n]);
        expect(reads).toEqual([1]);
    });

    it('keeps internal binding checks on selected cells and skips them for empty results', () => {
        const source = ownedArray([1n, 2n]);
        const checked: RankArray = { kind: 'array', shape: [2], items: [], itemAt: () => { throw new Error('binding'); } };
        registerScalarView(checked, source, i => i, { linear: () => ({ offset: 0, stride: 1 }), scalarCheck: true,
            check: () => { throw new Error('binding'); } });
        expect(cells(materializeSequence(maskSelection(checked, ownedArray([false, false]))))).toEqual([]);
        expect(() => materializeSequence(maskSelection(checked, ownedArray([false, true])))).toThrow('binding');
    });

    it('can cancel direct compaction before allocating a published result', () => {
        const selected = maskSelection(ownedArray(Array(8192).fill(1n)), ownedArray(Array(8192).fill(true)));
        const signal = new Int32Array(new SharedArrayBuffer(4)); signal[0] = 1;
        expect(() => withInterrupt(signal, () => materializeSequence(selected))).toThrow(InterruptedError);
    });
});

for (const compilation of [false, true]) describe(`mask materialization (compiled=${compilation})`, () => {
    it('preserves views, selection snapshots and independently writable results', () => {
        const runtime = new Interpreter(undefined, { compilation }), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute(`use sequences
A = 1 to 10000 array
V = A (9999 to 0 by -2)
M = V greater 5000
S' = V filter M
Changed = M copy
Changed 0 = false
A 9999 = 0`);
            const result = diagnostics.run(() => runtime.execute('B = S array\nB sum'));
            expect(result).toBe(18752500n);
            expect(diagnostics.cellsComputed).toBe(0);
            expect(diagnostics.maskMaterializations).toBe(1);
            expect(diagnostics.maskMaterializedCells).toBe(2500);
            runtime.execute('B 0 = 9');
            expect(runtime.execute('S first')).toBe(10000n);
            expect(runtime.execute('A 9999')).toBe(0n);
        } finally { runtime.dispose(); }
    });

    it('keeps tensor atom and row filtering distinct', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('use sequences\nA = (1 to 6 array) reshape 3 2');
            expect(formatValue(runtime.execute('(A filter (A greater 3)) array')!)).toBe('4 5 6');
            expect(formatValue(runtime.execute('(A filter (array false true false)) copy')!)).toBe('3 4');
        } finally { runtime.dispose(); }
    });
});
