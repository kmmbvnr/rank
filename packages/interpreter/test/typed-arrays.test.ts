import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo } from './support.js';

// Integer and real columns without gaps are held in typed buffers. Behaviour
// must be the same as with plain cells.
const CSV = [
    'A,B,C,X',
    '1,2,3,1.5',
    '4,5,6,2.5',
    '7,8,9,3.5',
].join('\n');

function session() {
    const io = new MemoryIo({ '/in.csv': CSV });
    const runtime = new Interpreter(undefined, { io });
    runtime.execute('use tables\nuse stats\nuse sequences\nuse numbers\nData = "/in.csv" csv');
    const show = (source: string) => formatValue(runtime.execute(source)!);
    return { runtime, show };
}

describe('typed column storage', () => {
    it('reads a column and a matrix of columns cell by cell', () => {
        const { show } = session();
        expect(show('Data .A')).toBe('1 4 7');
        expect(show('Data .X')).toBe('1.5 2.5 3.5');
        expect(show('M = Data (array .A .B .C)\nM 1 2')).toBe('6');
        expect(show('M shape')).toBe('3 3');
    });

    it('does arithmetic and reductions on them', () => {
        const { show } = session();
        expect(show('M = Data (array .A .B .C)\nM sum axis 1')).toBe('6 15 24');
        expect(show('(M * 2) sum')).toBe('90');
        expect(show('(Data .X / 2.0) sum')).toBe('3.75');
        expect(show('Data .A mean')).toBe('4');
    });

    it('keeps integers integers and reals reals', () => {
        const { show } = session();
        expect(show('(Data .A) 0')).toBe('1');
        expect(show('(Data .X) 0')).toBe('1.5');
        expect(show('M = Data (array .A .B .C)\nM 0 0 + 1')).toBe('2');
    });

    it('is a value: a write copies and never reaches the table or another name', () => {
        const { show } = session();
        expect(show('M = Data (array .A .B .C)\nN = M\nM 0 0 = 100\nN 0 0')).toBe('1');
        expect(show('Data .A')).toBe('1 4 7');
        expect(show('K = Data .A\nK 0 = 100\nData .A')).toBe('1 4 7');
        expect(show('K 0')).toBe('100');
    });

    it('accepts a value of another type after a write converts it', () => {
        const { show } = session();
        expect(show('K = Data .A\nK 1 = 2.5\nK 1')).toBe('2.5');
    });

    it('slices and selects rows', () => {
        const { show } = session();
        expect(show('M = Data (array .A .B .C)\nM 1 #')).toBe('4 5 6');
        expect(show('M # 2')).toBe('3 6 9');
    });
});

describe('typed results of real arithmetic', () => {
    const run = (source: string) => {
        const runtime = new Interpreter();
        try { return formatValue(runtime.execute(source)!); } finally { runtime.dispose(); }
    };
    const real = 'use linalg\nuse sequences\nuse stats\nA = array shape 2000 fill 1.5\nB = array shape 2000 fill 0.5\n';

    it('adds, subtracts, multiplies and divides reals like the small path', () => {
        expect(run(`${real}(A + B) sum`)).toBe('4000');
        expect(run(`${real}(A - B) sum`)).toBe('2000');
        expect(run(`${real}(A * B) sum`)).toBe('1500');
        expect(run(`${real}(A / B) sum`)).toBe('6000');
        expect(run(`${real}(A * 2.0 - 1.0) sum`)).toBe('4000');
        expect(run('use stats\nA = array shape 4 fill 1.5\nB = array shape 4 fill 0.5\n(A / B) sum')).toBe('12');
    });

    it('divides by a zero real like the small path', () => {
        expect(() => run('A = array shape 4 fill 1.5\nZ = array shape 4 fill 0.0\n(A / Z) 0')).toThrowError('division by zero');
        expect(() => run(`${real}Z = array shape 2000 fill 0.0\n(A / Z) 0`)).toThrowError('division by zero');
    });

    it('is a value: a write after the arithmetic never reaches the result', () => {
        expect(run(`${real}C = A + B\nA 0 = 100.0\nC 0`)).toBe('2');
        expect(run(`${real}C = A + B\nC 0 = 100.0\nA 0`)).toBe('1.5');
    });

    it('keeps mixed integer and real cells correct', () => {
        expect(run('use stats\nA = array shape 2000 fill 3\nB = array shape 2000 fill 1.5\n(A * B) sum')).toBe('9000');
        expect(run('use stats\nA = array shape 2000 fill 3\nB = array shape 2000 fill 2\n(A * B) sum')).toBe('12000');
    });

    it('multiplies matrices and transposes them', () => {
        const matrices = 'M = array shape 100 30 fill 2.0\nV = array shape 30 fill 0.5\n';
        expect(run(`${real}${matrices}(M V matmul) sum`)).toBe('3000');
        expect(run(`${real}${matrices}(M transpose) shape`)).toBe('30 100');
        expect(run(`${real}${matrices}((M transpose) (array shape 100 fill 1.0) matmul) sum`)).toBe('6000');
    });

    it('maps a large real array through a numeric function', () => {
        expect(run('use numbers\nuse stats\nA = array shape 2000 fill 4.0\n(A sqrt) sum')).toBe('4000');
    });
});
