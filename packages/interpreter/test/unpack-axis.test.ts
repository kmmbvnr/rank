import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const matrix = ['use sequences', 'use algo', 'M = ((1 to 6) array) (array 2 3) reshape'];
const program = (...lines: string[]) => run([...matrix, ...lines].join('\n'));

describe('unpack along an axis', () => {
    it('keeps unpacking a rank-1 array or tuple item by item', () => {
        expect(run('unpack A B C = array 7 8 9\nB')).toBe('8');
    });

    it('gives the leading-axis slices of a matrix by default', () => {
        expect(program('unpack R0 R1 = M', 'tuple R0 R1')).toBe('1 2 3 4 5 6');
        expect(program('unpack R0 R1 = M', 'R1 sum')).toBe('15');
    });

    it('slices along the axis named after the source', () => {
        expect(program('unpack C0 C1 C2 = M axis 1', 'tuple C0 C2')).toBe('1 4 3 6');
        expect(program('unpack R0 R1 = M axis 0', 'R0 sum')).toBe('6');
    });

    it('checks the count, the axis and the source', () => {
        expect(() => program('unpack A B = M axis 1')).toThrow('unpack expects 2 values, got 3');
        expect(() => program('unpack A B = M axis 2')).toThrow('unpack axis out of bounds: 2');
        expect(() => run('unpack A B = 3')).toThrow('unpack expects an array or tuple value');
    });

    it('feeds a push, a call and a spread from the same slices', () => {
        expect(program('Q = new queue', 'Q push unpack M axis 1', 'tuple (Q len) (Q pop)')).toBe('3 1 4');
        expect(program('Q = new queue', 'Q push unpack M', 'Q len')).toBe('2');
    });
});
