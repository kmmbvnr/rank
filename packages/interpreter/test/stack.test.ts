import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import { concatValues, stackValues } from '../src/modules/sequences.js';
import { sequence } from '../src/sequence.js';
import { isRankSequence, type RankArray } from '../src/value.js';

function run(source: string): string {
    const runtime = new Interpreter();
    runtime.execute('use sequences');
    return formatValue(runtime.execute(source)!);
}

describe('stack', () => {
    it('stacks equally shaped arrays and matches copy', () => {
        const items = 'A = array 1 2 3\nB = array 4 5 6\n';
        expect(run(`${items}S = stack A B\nS shape`)).toBe('2 3');
        expect(run(`${items}stack A B`)).toBe(run(`${items}(array A B) copy`));
        expect(run(`${items}stack A B transpose shape`)).toBe('3 2');
        expect(run(`${items}stack A B A transpose shape`)).toBe('3 3');
        expect(run(`${items}Items = array A B\nstack unpack Items`)).toBe(run(`${items}stack A B`));
        expect(run(`${items}stack unpack (tuple A B)`)).toBe(run(`${items}stack A B`));
        expect(run('stack unpack (array shape 0 fill 0) shape')).toBe('0');
    });

    it('keeps value semantics: later writes to a name do not change the stack', () => {
        const before = 'A = array 1 2\nB = array 3 4\nS = stack A B\n';
        expect(run(`${before}A 0 = 9\nS`)).toBe(run('A = array 1 2\nB = array 3 4\n(array A B) copy'));
    });

    it('stacks sequences of exact size', () => {
        expect(run('S = stack (1 to 3) (4 to 6)\nS shape')).toBe('2 3');
        expect(run('stack (1 to 3) (4 to 6)')).toBe(run('(array (1 to 3) (4 to 6)) copy'));
        expect(run('stack (array 1 2) (3 to 4) shape')).toBe('2 2');
    });

    it('rejects sequences of unknown size, suggesting copy', () => {
        expect(() => run('use numbers\nS = stack ((1 to 6) filter even) (1 to 3)\nS')).toThrow(/unknown size/);
    });

    it('rejects different shapes and mixed scalars', () => {
        expect(() => run('S = stack (array 1 2) (array 1 2 3)\nS')).toThrow(/same shape/);
        expect(() => run('S = stack (array 1 2) 3\nS')).toThrow(/arrays or sequences/);
    });

    it('requires the prefix form and the sequences module', () => {
        expect(() => run('(array (array 1 2) (array 3 4)) stack')).toThrow(/use stack A B/);
        expect(() => new Interpreter().execute('S = stack (array 1 2) (array 3 4)'))
            .toThrow(/use sequences/);
    });
});

describe('axis-aware stack and concat', () => {
    const matrices = 'A = array 1 2 3 4 shape 2 2\nB = array 5 6 7 8 shape 2 2\n';

    it('inserts or extends the requested axis for several arrays', () => {
        expect(run(`${matrices}stack A B A B shape`)).toBe('4 2 2');
        expect(run(`${matrices}stack A B A B axis 1 shape`)).toBe('2 4 2');
        expect(run(`${matrices}stack A B axis 2 shape`)).toBe('2 2 2');
        expect(run(`${matrices}concat A B A B shape`)).toBe('8 2');
        expect(run(`${matrices}concat A B A B axis 1 shape`)).toBe('2 8');
        expect(run(`${matrices}concat A B axis 1`)).toBe('1 2 5 6 3 4 7 8');
        expect(run(`${matrices}Parts = array A B\nconcat unpack Parts axis 1 shape`)).toBe('2 4');
        expect(run(`${matrices}Parts = array A B\nstack unpack Parts axis 1 shape`)).toBe('2 2 2');
    });

    it('checks axes and non-concatenated dimensions', () => {
        expect(() => run(`${matrices}concat A B axis 2`)).toThrow(/axis 2/);
        expect(() => run(`${matrices}stack A B axis 3`)).toThrow(/axis 3/);
        expect(() => run(`${matrices}concat A B axis true`)).toThrow(/axis expects a nonnegative integer/);
        expect(() => run('concat (array 1 2 shape 1 2) (array 1 2 3 shape 1 3)'))
            .toThrow(/non-concatenated axes/);
        expect(run('concat (array shape 0 2 fill 1) (array 3 4 shape 1 2) shape')).toBe('1 2');
        expect(() => run('concat (array 1 2) (array "a" "b")'))
            .toThrow(/homogeneous|element type|same type/);
    });

    it('keeps the values captured before a source name is changed', () => {
        expect(run('A = array 1 2\nB = array 3 4\nC = concat A B\nA 0 = 9\nC'))
            .toBe('1 2 3 4');
    });

    it('keeps rank-one sequences lazy, including unknown length', () => {
        expect(run('concat (1 to 3) (4 to 6)')).toBe('1 2 3 4 5 6');
        expect(run('use numbers\nconcat ((1 to 6) filter even) (array 7 8) copy'))
            .toBe('2 4 6 7 8');
    });

    it('reads only the selected source cell', () => {
        const reads: string[] = [];
        const source = (name: string): RankArray => ({ kind: 'array', shape: [2, 2], items: [],
            itemAt: index => { reads.push(`${name}${index}`); return BigInt(index); } });
        const a = source('a'), b = source('b');
        const joined = concatValues([a, b], 1) as RankArray;
        const stacked = stackValues([a, b], 1);
        expect(reads).toEqual([]);
        expect(readArrayItem(joined, 2)).toBe(0n);
        expect(reads).toEqual(['b0']);
        expect(readArrayItem(stacked, 2)).toBe(0n);
        expect(reads).toEqual(['b0', 'b0']);
    });

    it('does not consume a single-pass source when constructed', () => {
        let reads = 0;
        const values = [1n, 2n].values();
        const input = sequence({ name: 'one pass', size: { kind: 'unknown' }, singlePass: true,
            *iterate() { reads++; yield* values; } });
        const joined = concatValues([input, input]);
        expect(isRankSequence(joined)).toBe(true);
        if (!isRankSequence(joined)) throw new Error('expected a sequence');
        expect(joined.plan.singlePass).toBe(true);
        expect(reads).toBe(0);
        expect([...joined.plan.iterate()]).toEqual([1n, 2n]);
        expect(reads).toBe(2);
    });
});
