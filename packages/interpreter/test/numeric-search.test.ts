import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankValue, type RankArray } from '../src/index.js';
import { ownedArray, typedArray, readArrayItem } from '../src/array-storage.js';
import { RuntimeDiagnostics } from '../src/diagnostics.js';
import { numericFind, rankedNumericFind } from '../src/numeric-search.js';
import { findValue } from '../src/modules/sequence-search.js';
import { run } from './support.js';

const format = (value: RankValue | undefined) => formatValue(value!);

describe('numeric search', () => {
    it.each([
        [[3n, 2n, 3n], 3n], [[3n, 2n, 3n], 2],
        [[NaN, 1, NaN], NaN], [[-0, 2], 0n],
        [[9007199254740993n, 9007199254740992n], 9007199254740992],
        [[9007199254740992, 2], 9007199254740992n],
        [[true, false, true], false], [[1n << 90n, 1n], 1n << 90n],
    ] as [RankValue[], RankValue][])('matches exact structural equality for case %#', (items, target) => {
        const source = ownedArray(items, [items.length], true);
        const generic: RankArray = { kind: 'array', shape: [items.length], items };
        expect(numericFind(source, target)).toBe(findValue(generic, target));
        expect(rankedNumericFind(source)(target)).toBe(findValue(generic, target));
    });

    it('does not round unsafe targets or confuse booleans with integers', () => {
        const source = typedArray(new Float64Array([9007199254740992, 1]));
        expect(() => numericFind(source, 9007199254740993n)).toThrow('no matching value');
        expect(() => rankedNumericFind(source)(true)).toThrow('no matching value');
    });

    it('builds once for a shaped target frame and aliases of standard find', () => {
        const runtime = new Interpreter(), d = new RuntimeDiagnostics();
        runtime.execute('use sequences\nf = find\nV = array 5 2 5\nQ = (array 2 5 5 2) reshape 2 2');
        const result = d.run(() => runtime.execute('V Q f copy'));
        expect(format(result)).toBe('1 0 0 1');
        expect((result as RankArray).shape).toEqual([2, 2]);
        expect(d.numericSearchIndexes).toBe(1);
        expect(d.numericSearches).toBe(4);
    });

    it('refreshes an invocation index after source writes', () => {
        const source = ownedArray([3n, 2n, 3n]), find = rankedNumericFind(source), d = new RuntimeDiagnostics();
        d.run(() => {
            expect(find(3n)).toBe(0n);
            expect(find(2n)).toBe(1n);
            source.items[0] = 1n;
            expect(find(3n)).toBe(2n);
        });
        expect(d.numericSearchIndexes).toBe(2);
    });

    it('keeps errors lazy, default elementwise, and shares the default query index', () => {
        expect(run('use sequences\nV = array 1 2\nQ = array 2 9\nR = V Q find\nR 0')).toBe('1');
        expect(run('use sequences\nV = array 1 2\nQ = array 2 9\nV Q find default -1')).toBe('1 -1');
        const runtime = new Interpreter(), d = new RuntimeDiagnostics();
        expect(format(d.run(() => runtime.execute('use sequences\nV = array 1 2\nQ = array 2 9\nV Q find default -1')))).toBe('1 -1');
        expect(d.numericSearchIndexes).toBe(1);
        expect(() => run('use sequences\n(array 1 2) (array 2 9) find copy')).toThrow('no matching value');
    });

    it('retains snapshots and leaves overrides and user functions alone', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nV = array 1 2 1\nQ = array 1 2\nR = V Q find');
        expect(format(runtime.execute('R copy'))).toBe('0 1');
        runtime.execute('V 0 = 3');
        expect(format(runtime.execute('R copy'))).toBe('0 1');
        expect(format(runtime.execute('V Q find copy'))).toBe('2 1');
        expect(run('use sequences\n(array 3 1 3) (array 1 3) find rank 1 0')).toBe('1 0');
        expect(run('fun V X find = 42\n(array 1 2) (array 2 1) find')).toBe('42');
    });

    it('does not speculatively read lazy or host-backed source cells', () => {
        let reads = 0;
        const source: RankArray = { kind: 'array', shape: [2], items: [], itemAt(i) { reads++; if(i) throw Error('suffix'); return 1n; } };
        expect(numericFind(source, 1n)).toBeUndefined();
        expect(rankedNumericFind(source)(1n)).toBeUndefined();
        expect(reads).toBe(0);
        expect(findValue(source, 1n)).toBe(0n);
        expect(reads).toBe(1);
        expect(readArrayItem(ownedArray([1n]), 0)).toBe(1n);
    });
});
