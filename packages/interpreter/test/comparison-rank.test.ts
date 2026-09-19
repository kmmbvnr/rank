import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

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

    it('selects frame axes for columns and reorders larger frames', () => {
        expect(run(matrix + 'A B equal axis 1 rank 1')).toBe('true false');
        expect(run(matrix + 'A B equal axis 0 rank 1')).toBe('false true');
        expect(run('A = array shape 2 3 4 fill 1\nB = A copy\nB 1 2 0 = 9\nR = A B equal axis 1 0 rank 1\nR shape'))
            .toBe('3 2');
        expect(run('A = array shape 2 3 4 fill 1\nB = A copy\nB 1 2 0 = 9\nA B equal axis 1 0 rank 1'))
            .toBe('true true true true true false');
    });

    it('broadcasts frames, handles empty frames and keeps a named result', () => {
        expect(run('A = array shape 2 3 fill 1\nB = array 1 1 1\nA B equal rank 1')).toBe('true true');
        expect(run('A = array shape 0 3 fill 1\nB = array 1 1 1\nR = A B equal rank 1\nR shape')).toBe('0');
        expect(run(matrix + 'R = A B equal rank 1\nBefore = R 0\nB 0 1 = 1\nR 0')).toBe('false');
        expect(run(matrix + 'R = A B equal rank 1\nB 0 1 = 1\n(A B equal rank 1) 0')).toBe('true');
        expect(() => run('A = array shape 2 3 fill 1\nB = array shape 4 3 fill 1\nA B equal rank 1'))
            .toThrow('shape mismatch');
    });

    it('validates axes and ranks', () => {
        for (const suffix of ['axis 2 rank 1', 'axis 0 0 rank 0', 'axis 0 rank 0', 'axis 0 rank 3', 'rank -1', 'rank 1.5']) {
            expect(() => run(matrix + `A B equal ${suffix}`)).toThrow();
        }
        expect(() => run('3 3 equal axis 0 rank 0')).toThrow('arrays');
    });

    it('keeps rank-zero sequences lazy and compares bounded sequences at rank one', () => {
        expect(run('A = 1 to 5\nMask = A 3 greater rank 0\nA Mask sum')).toBe('9');
        expect(run('(1 to 3) (array 1 2 3) equal rank 1')).toBe('true');
        expect(() => run('primes (array 2 3) equal rank 1')).toThrow('bounded sequence');
    });
});
