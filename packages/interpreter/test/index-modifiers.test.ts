import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const check = (lines: string[]) => run(['use sequences', ...lines].join('\n'));

describe('max and min .index', () => {
    it('returns the first position of the extreme', () => {
        expect(check(['A = array 3 9 2 9 2', 'A max .index'])).toBe('1');
        expect(check(['A = array 3 9 2 9 2', 'A min .index'])).toBe('2');
    });

    it('returns the value and position as a pair', () => {
        expect(check(['A = array 3 9 2 9', 'unpack V P = A max .indexed', 'V * 10 + P'])).toBe('91');
        expect(check(['A = array 3 9 2 9', 'unpack V P = A min .indexed', 'V * 10 + P'])).toBe('22');
    });

    it('works on ranges and text values', () => {
        expect(check(['1 to 5 max .index'])).toBe('4');
        expect(check(['A = array "b" "c" "a"', 'A min .index'])).toBe('2');
    });

    it('keeps the plain forms unchanged', () => {
        expect(check(['A = array 3 9 2', 'A max'])).toBe('9');
        expect(check(['3 7 max'])).toBe('7');
        expect(check(['A = array 1 5 3', 'A 4 max equal (array 4 5 4) and reduce'])).toBe('true');
    });

    it('rejects an empty array and higher ranks', () => {
        expect(() => check(['A = array 1 2 3 4', 'Shape = array 2 2', 'B = A Shape reshape', 'B max .index'])).toThrow(/rank-1/);
        expect(() => check(['E = (array 1 2) filter (array false false)', 'E max .index'])).toThrow(/at least one value/);
    });
});

describe('sort .indexes and .indexed', () => {
    it('returns the permutation that orders the values', () => {
        expect(check(['A = array 3 9 2 9', '(A sort .indexes equal array 2 0 1 3) and reduce'])).toBe('true');
        expect(check(['A = array 3 9 2 9', '(A sort .index equal array 2 0 1 3) and reduce'])).toBe('true');
    });

    it('composes with a direction in either order and keeps ties stable', () => {
        expect(check(['A = array 3 9 2 9', '(A sort .indexes .descending equal array 1 3 0 2) and reduce'])).toBe('true');
        expect(check(['A = array 3 9 2 9', '(A sort .descending .indexes equal array 1 3 0 2) and reduce'])).toBe('true');
    });

    it('returns sorted values beside the permutation', () => {
        expect(check(['A = array 3 9 2 9', 'unpack S I = A sort .indexed',
            '((S equal array 2 3 9 9) and reduce) and ((I equal array 2 0 1 3) and reduce)'])).toBe('true');
    });

    it('lets a pipeline continue after the labels', () => {
        expect(check(['A = array 3 9 2 9', '(A sort .indexes take 2 equal array 2 0) and reduce'])).toBe('true');
    });

    it('rejects two result modes and argsort with a mode', () => {
        expect(() => check(['A = array 3 1', 'A sort .indexes .indexed'])).toThrow(/one of/);
        expect(() => check(['A = array 3 1', 'A argsort .indexes'])).toThrow(/argsort/);
    });
});
