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
