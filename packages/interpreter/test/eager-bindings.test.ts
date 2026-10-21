import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankArray } from '../src/index.js';
import { ownedArray, readArrayItem } from '../src/array-storage.js';
import { sequence } from '../src/sequence.js';
import { MissingValueError } from '../src/errors.js';
import { materializeValue } from '../src/materialize.js';
import { InterruptedError, withInterrupt } from '../src/interrupt.js';
import { MISSING } from '../src/value.js';

function lazyArray(cells: () => bigint[]): { value: RankArray; reads: () => number } {
    let reads = 0;
    return { value: { kind: 'array', shape: [2, 2], items: [],
        itemAt: index => { reads++; return cells()[index]; } }, reads: () => reads };
}

describe.each([false, true])('eager assignment boundaries (compilation=%s)', compilation => {
    it('stores a finite range as an array', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('A = 1 to 4');
            expect(runtime.variables.get('A')).toMatchObject({ kind: 'array', shape: [4] });
            expect(formatValue(runtime.variables.get('A')!)).toBe('1 2 3 4');
        } finally { runtime.dispose(); }
    });

    it('forces lazy cells once at assignment while preserving shape', () => {
        let cells = [1n, 2n, 3n, 4n];
        const source = lazyArray(() => cells);
        const runtime = new Interpreter(undefined, { compilation });
        runtime.variables.set('Input', source.value);
        try {
            runtime.execute('Stored = Input');
            expect(source.reads()).toBe(4);
            const stored = runtime.variables.get('Stored') as RankArray;
            expect(stored.shape).toEqual([2, 2]);
            cells = [9n, 9n, 9n, 9n];
            expect(readArrayItem(stored, 0)).toBe(1n);
            expect(formatValue(runtime.execute('Stored sum')!)).toBe('10');
            expect(formatValue(runtime.execute('Stored sum')!)).toBe('10');
            expect(source.reads()).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('keeps a deferred range with its native indexing and bounds', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute("Source' = 1 to #");
            expect(runtime.variables.get('Source')).toMatchObject({ kind: 'sequence', plan: {
                size: { kind: 'infinite' }, at: expect.any(Function),
            } });
            expect(runtime.execute('Source 100')).toBe(101n);
            expect(() => runtime.execute('Stored = Source')).toThrowError('cannot materialize an infinite sequence');
            expect(runtime.variables.has('Stored')).toBe(false);
        } finally { runtime.dispose(); }
    });

    it('materializes only the final bounded result of an infinite pipeline', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('A = ((1 to #) * 2) take 3');
            expect(runtime.variables.get('A')).toMatchObject({ kind: 'array', shape: [3] });
            expect(formatValue(runtime.variables.get('A')!)).toBe('2 4 6');
        } finally { runtime.dispose(); }
    });

    it('leaves the previous binding intact if completion fails', () => {
        const runtime = new Interpreter(undefined, { compilation });
        let reads = 0;
        runtime.variables.set('Input', { kind: 'array', shape: [2], items: [], itemAt: index => {
            reads++;
            if (index === 1) throw new Error('cell failed');
            return 3n;
        } });
        try {
            runtime.execute('Saved = array 1 2');
            const before = runtime.variables.get('Saved');
            expect(() => runtime.execute('Saved = Input')).toThrowError('cell failed');
            expect(runtime.variables.get('Saved')).toBe(before);
            expect(reads).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('recomputes a deferred sequence and retains an eager result explicitly', () => {
        const runtime = new Interpreter(undefined, { compilation });
        let reads = 0;
        runtime.variables.set('Input', sequence({ name: 'counted finite source', size: { kind: 'exact', value: 3n },
            *iterate() { for (const value of [1n, 2n, 3n]) { reads++; yield value; } },
        }));
        try {
            runtime.execute("Source' = Input");
            expect(reads).toBe(0);
            expect(runtime.execute('Source sum')).toBe(6n);
            expect(runtime.execute('Source sum')).toBe(6n);
            expect(reads).toBe(6);
            runtime.execute('Saved = Source');
            expect(reads).toBe(9);
            expect(runtime.execute('Saved sum')).toBe(6n);
            expect(runtime.execute('Saved sum')).toBe(6n);
            expect(reads).toBe(9);
        } finally { runtime.dispose(); }
    });

    it('stores a ranked reduction before its source is mutated', () => {
        const runtime = new Interpreter(undefined, { compilation });
        try {
            runtime.execute('Matrix = array shape 2 2\n 1 2\n 3 4\nend\nRows = Matrix sum rank 1');
            expect(runtime.variables.get('Rows')).toMatchObject({ kind: 'array', shape: [2] });
            runtime.execute('Matrix 0 0 = 99');
            expect(formatValue(runtime.execute('Rows')!)).toBe('3 7');
        } finally { runtime.dispose(); }
    });

    it('cancels completion without publishing partial cells and can retry', () => {
        const runtime = new Interpreter(undefined, { compilation });
        let reads = 0;
        runtime.variables.set('Input', { kind: 'array', shape: [4096], items: [],
            itemAt: index => { reads++; return BigInt(index); },
        });
        const signal = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(signal, 0, 1);
        try {
            runtime.execute('Saved = array 1 2');
            const before = runtime.variables.get('Saved');
            expect(() => withInterrupt(signal, () => runtime.execute('Saved = Input'))).toThrow(InterruptedError);
            expect(runtime.variables.get('Saved')).toBe(before);
            expect(reads).toBeLessThan(4096);
            const partialReads = reads;
            runtime.execute('Saved = Input');
            expect(reads).toBe(partialReads + 4096);
            expect(runtime.execute('Saved 4095')).toBe(4095n);
        } finally { runtime.dispose(); }
    });

    it('demands only the consumed prefix before a scalar reduction', () => {
        const runtime = new Interpreter(undefined, { compilation });
        let reads = 0;
        runtime.variables.set('Input', sequence({ name: 'counted source', size: { kind: 'infinite' },
            *iterate() { for (let index = 1n; ; index++) { reads++; yield index; } },
        }));
        try {
            expect(runtime.execute('Saved = (Input take 4) sum')).toBe(10n);
            expect(reads).toBe(4);
            expect(runtime.execute('Saved + Saved')).toBe(20n);
            expect(reads).toBe(4);
        } finally { runtime.dispose(); }
    });
});

describe('binding materialization storage', () => {
    it('retains ready packed arrays and scalar values', () => {
        const ready = ownedArray([1n, 2n], [2]);
        expect(materializeValue(ready)).toBe(ready);
        expect(materializeValue(3n)).toBe(3n);
    });

    it('retains empty tensor shape and table metadata', () => {
        const source: RankArray = { kind: 'array', shape: [0, 3], items: [],
            itemAt: () => { throw new Error('no cells'); },
            columnNames: ['a', 'b', 'c'], tableScopes: ['Data'], sortKeys: [],
        };
        const result = materializeValue(source);
        expect(result).toMatchObject({ shape: [0, 3], columnNames: ['a', 'b', 'c'], tableScopes: ['Data'], sortKeys: [] });
        expect((result as RankArray).itemAt).toBeUndefined();
    });

    it('stores soft missing cells and preserves hard failures', () => {
        const soft: RankArray = { kind: 'array', shape: [1], items: [],
            itemAt: () => { throw new MissingValueError('soft missing', true); },
        };
        const stored = materializeValue(soft) as RankArray;
        expect(readArrayItem(stored, 0)).toBe(MISSING);
        const hard = { ...soft, itemAt: () => { throw new MissingValueError('hard missing'); } };
        expect(() => materializeValue(hard)).toThrowError('hard missing');
    });
});
