import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankArray } from '../src/index.js';

import { ownedArray } from '../src/array-storage.js';
import { compareStoredArrayCells } from '../src/value-comparison.js';

it('does not probe host properties while admitting stored cell comparison', () => {
    const host: RankArray = { kind: 'array', shape: [2, 2], items: [],
        get itemAt(): never { throw Error('host reader must not be probed'); } };
    expect(compareStoredArrayCells(host, ownedArray([1n, 2n]), 1, false)).toBeUndefined();
});

for (const compiled of [true, false]) describe(`comparison rank (compiled: ${compiled})`, () => {
    function run(source: string): string {
        const runtime = new Interpreter(undefined, {
            scalarCompilation: compiled, blockCompilation: compiled,
            integerLoopCompilation: compiled, tensorFusion: compiled,
        });
        try { return formatValue(runtime.execute('use sequences\n' + source)!); }
        finally { runtime.dispose(); }
    }
    const matrix = 'A = array shape 2 2 fill 1\nB = array shape 2 2 fill 1\nB 0 1 = 9\n';

    it('preserves infix masks and compares cells at the requested rank', () => {
        expect(run(matrix + 'A equal B')).toBe('true false true true');
        expect(run(matrix + 'A B equal rank 0')).toBe('true false true true');
        expect(run(matrix + 'A B equal rank 1')).toBe('false true');
        expect(run(matrix + 'A B equal rank 2')).toBe('false');
        expect(run('A = array 1 2\nA A equal rank 1')).toBe('true');
        expect(run('(array 1 2) (array 1 2 3) equal rank 1')).toBe('false');
        expect(run('3 3 equal rank 0')).toBe('true');
    });

    it('orders complete cells and supports negated comparisons', () => {
        const source = 'A = array 1 9\nB = array 2 0\n';
        for (const [op, result] of [['less', 'true'], ['greater', 'false'],
            ['at least', 'false'], ['at most', 'true'], ['not equal', 'true']]) {
            expect(run(source + `A B ${op} rank 1`)).toBe(result);
        }
        expect(run('(array 1 2) (array 1 2 0) less rank 1')).toBe('true');
        expect(run(matrix + 'A B less rank 1 count')).toBe('1');
    });

    it('selects cell axes for columns and keeps remaining frame order', () => {
        expect(run(matrix + 'A B equal axis 0')).toBe('true false');
        expect(run(matrix + 'A B equal axis 1')).toBe('false true');
        expect(run('A = array shape 2 3 4 fill 1\nB = A copy\nB 1 2 0 = 9\nR = A B equal axis 2\nR shape'))
            .toBe('2 3');
        expect(run('A = array shape 2 3 4 fill 1\nB = A copy\nB 1 2 0 = 9\nA B equal axis 2'))
            .toBe('true true true true true false');
    });

    it('selects a separate vector axis for each operand', () => {
        const source = 'A = (1 to 6) reshape 2 3\nB = (array 1 4 2 5 3 6) reshape 3 2\n';
        for (const [op, expected] of [['equal', 'true true'], ['not equal', 'false false'],
            ['less', 'false false'], ['greater', 'false false'],
            ['at least', 'true true'], ['at most', 'true true']]) {
            expect(run(source + `A B ${op} axis 1 0`)).toBe(expected);
        }
        expect(run(source + 'A B equal axis -1 -2')).toBe('true true');
        expect(run(source + 'A A equal axis 1 1')).toBe('true true');
        expect(run(source + 'A A equal axis 1 -1')).toBe('true true');
        expect(run(source + 'A B equal axis 1 0 rank 1')).toBe('true true');
        expect(run('A = array shape 2 3 fill 1\nB = array 1 1 1\nA B equal axis 1 0')).toBe('true true');
        expect(run('A = array shape 2 3 fill 1\nB = array shape 1 4 fill 1\nA B equal axis 1')).toBe('false false');
        expect(run('A = array shape 0 3 fill 1\nB = array shape 3 1 fill 1\nR = A B equal axis 1 0\nR shape')).toBe('0');
        expect(run('A = array shape 2 0 fill 1\nB = array shape 0 2 fill 1\nA B equal axis 1 0')).toBe('true true');
        expect(() => run(source + 'A B equal axis 0 1 2')).toThrow('one or two axes');
        expect(() => run(source + 'A B equal axis 0 2')).toThrow();
        expect(() => run(source + 'A B equal axis 0 0')).toThrow('shape mismatch');
        expect(() => run(source + 'A B equal axis 1 0 rank 2')).toThrow('cell rank 1');
    });

    it('broadcasts frames, handles empty frames and keeps a named result', () => {
        expect(run('A = array shape 2 3 fill 1\nB = array 1 1 1\nA B equal rank 1')).toBe('true true');
        expect(run('A = array shape 0 3 fill 1\nB = array 1 1 1\nR = A B equal rank 1\nR shape')).toBe('0');
        expect(run(matrix + 'R = A B equal rank 1\nBefore = R 0\nB 0 1 = 1\nR 0')).toBe('false');
        expect(run(matrix + 'R = A B equal rank 1\nB 0 1 = 1\n(A B equal rank 1) 0')).toBe('true');
        expect(() => run('A = array shape 2 3 fill 1\nB = array shape 4 3 fill 1\nA B equal rank 1'))
            .toThrow('shape mismatch');
    });

    it('compares stored matrix cells under broadcast frames', () => {
        const source = 'A = (1 to 12) reshape 2 2 3\nB = (1 to 6) reshape 2 3\n';
        expect(run(source + 'A B equal rank 2')).toBe('true false');
        expect(run(source + 'A B not equal rank 2')).toBe('false true');
        expect(run(source + 'C = (1 to 12) reshape 2 3 2\nA C equal rank 2')).toBe('false false');
    });

    it('retains exact mixed numeric equality and boolean errors in stored rows', () => {
        expect(run('A = (array 9007199254740993 2) reshape 2 1\nB = array 9007199254740992.0\nA B equal rank 1'))
            .toBe('false false');
        expect(run('A = (array 1 2 1 3) reshape 2 2\nB = array 1.0 2.0\nA B equal rank 1'))
            .toBe('true false');
        expect(() => run('A = array shape 2 2 fill true\nB = array 1 1\nA B equal rank 1'))
            .toThrow('cannot compare boolean and numeric');
    });

    it('validates axes and ranks', () => {
        for (const suffix of ['axis 2 rank 1', 'axis 0 0 rank 0', 'axis 0 rank 0', 'axis 0 rank 3', 'rank -1', 'rank 1.5']) {
            expect(() => run(matrix + `A B equal ${suffix}`)).toThrow();
        }
        expect(() => run('3 3 equal axis 0')).toThrow('arrays');
    });

    it('keeps rank-zero sequences lazy and compares bounded sequences at rank one', () => {
        expect(run('A = 1 to 5\nMask = A 3 greater rank 0\nA Mask sum')).toBe('9');
        expect(run('(1 to 3) (array 1 2 3) equal rank 1')).toBe('true');
        expect(() => run('primes (array 2 3) equal rank 1')).toThrow('bounded sequence');
    });
});
