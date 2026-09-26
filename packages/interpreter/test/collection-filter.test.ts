import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const NUMBERS = 'use numbers\nuse sequences\nN = 1 to 10 array\n';

describe('filter over plain collections', () => {
    it('takes the filtered value as the elided left operand of a comparison', () => {
        expect(run(`${NUMBERS}N filter greater 5`)).toBe('6 7 8 9 10');
        expect(run(`${NUMBERS}N filter at least 8`)).toBe('8 9 10');
        expect(run(`${NUMBERS}N filter at most 3`)).toBe('1 2 3');
        expect(run(`${NUMBERS}N filter not equal 5`)).toBe('1 2 3 4 6 7 8 9 10');
        expect(run(`${NUMBERS}N filter multiple by 4`)).toBe('4 8');
        expect(run(`${NUMBERS}N filter in primes`)).toBe('2 3 5 7');
    });

    it('applies a predicate that is not a comparison to the filtered value', () => {
        expect(run(`${NUMBERS}N filter even`)).toBe('2 4 6 8 10');
        expect(run(`${NUMBERS}N filter odd`)).toBe('1 3 5 7 9');
        expect(run(`${NUMBERS}fun big X\n  return X greater 7\nend\nN filter big`))
            .toBe('8 9 10');
    });

    it('combines elided subjects inside one condition line', () => {
        expect(run(`${NUMBERS}N filter greater 3 and less 8`)).toBe('4 5 6 7');
        expect(run(`${NUMBERS}N filter multiple by 3 or multiple by 5`)).toBe('3 5 6 9 10');
        expect(run(`${NUMBERS}N filter less 3 xor even`)).toBe('1 4 6 8 10');
        expect(run(`${NUMBERS}N filter not even`)).toBe('1 3 5 7 9');
    });

    it('joins the lines of a block with and, as table conditions do', () => {
        expect(run(`${NUMBERS}B = N filter\n  greater 2\n  even\nend\nB`)).toBe('4 6 8 10');
        expect(run(`${NUMBERS}B = N filter\n  greater 2\n  even\n  less 9\nend\nB`)).toBe('4 6 8');
    });

    it('takes a bare name that holds a mask as the mask itself', () => {
        expect(run(`${NUMBERS}K = N greater 5\nN filter K`)).toBe('6 7 8 9 10');
        expect(run(`${NUMBERS}K = N even\nN filter K`)).toBe('2 4 6 8 10');
        // A name that holds an operation is still a predicate over the value.
        expect(run(`${NUMBERS}fun big X\n  return X greater 7\nend\nP = big\nN filter P`))
            .toBe('8 9 10');
    });

    it('selects table rows with a mask computed from a column', () => {
        const rows = 'use json\nuse tables\n'
            + 'R = "[{\\"a\\":1},{\\"a\\":3},{\\"a\\":5}]" json\n';
        expect(run(`${rows}Mask = R .a greater 2\n(R filter Mask) len`)).toBe('2');
    });

    it('keeps a condition that names its own subject', () => {
        expect(run(`${NUMBERS}Limit = 6\nN filter (N greater Limit)`)).toBe('7 8 9 10');
    });

    it('filters a lazy sequence without materializing its source', () => {
        expect(run('use sequences\nuse numbers\nFib = fibonacci to 100\nFib filter even'))
            .toBe('2 8 34');
        expect(run('use sequences\nuse numbers\nFib = fibonacci to 100\n(Fib filter even) sum'))
            .toBe('44');
        expect(run('use sequences\nuse numbers\nP = primes 8 take array\nP filter greater 5'))
            .toBe('7 11 13 17 19');
    });

    it('ravels the frame when a rank-0 predicate selects atoms of a tensor', () => {
        const matrix = 'use numbers\nM = array shape 2 3\n  1 2 3\n  4 5 6\nend\n';
        expect(run(`${matrix}M filter greater 3`)).toBe('4 5 6');
        expect(run(`${matrix}fun small X\n  return X less 4\nend\nM filter small rank 0`))
            .toBe('1 2 3');
    });

    it('selects along the frame when the predicate has a cell rank', () => {
        const matrix = 'use numbers\nuse sequences\nM = array shape 3 2\n  1 2\n  3 4\n  5 6\nend\n'
            + 'fun heavy V\n  return V sum greater 5\nend\n';
        expect(run(`${matrix}(M filter heavy rank 1) shape`)).toBe('2 2');
        expect(run(`${matrix}M filter heavy rank 1`)).toBe('3 4 5 6');
        expect(run(`${matrix}fun wide V\n  return V sum greater 9\nend\n`
            + '(M filter wide axis 1 rank 1) shape')).toBe('3 1');
        expect(run(`${matrix}fun wide V\n  return V sum greater 9\nend\n`
            + 'M filter wide axis 1 rank 1')).toBe('2 4 6');
    });

    it('reports a frame that does not line up with the filtered axis', () => {
        const matrix = 'use numbers\nM = array shape 3 2\n  1 2\n  3 4\n  5 6\nend\n';
        expect(() => run(`${matrix}K = array true false true false\nM filter (K)`))
            .toThrow(/does not match axis 0 of shape 3 2/);
        expect(() => run('use numbers\nT = array shape 2 2 2\n  1 2\n  3 4\n  5 6\n  7 8\nend\n'
            + 'fun heavy V\n  return V sum greater 5\nend\nT filter heavy axis 0 1 rank 1'))
            .toThrow(/two or more axes/);
    });

    it('does not change its input and composes with a following operation', () => {
        expect(run(`${NUMBERS}Kept = N filter even\nTotal = Kept sum\nN`))
            .toBe('1 2 3 4 5 6 7 8 9 10');
        expect(run(`${NUMBERS}(N filter even) sum`)).toBe('30');
        expect(run(`${NUMBERS}(N filter greater 5) len`)).toBe('5');
    });

    it('needs no table vocabulary, unlike a condition that names a column', () => {
        expect(run('N = array 1 2 3 4\nN filter greater 2')).toBe('3 4');
        expect(() => run('use json\nR = "[{\\"a\\":1},{\\"a\\":3}]" json\nR filter .a greater 2'))
            .toThrow(/tables/);
    });

    it('rejects a condition that is not a mask over the value', () => {
        expect(() => run(`${NUMBERS}N filter 1`))
            .toThrow(/boolean mask/);
        expect(() => run('use numbers\nX = 3\nX filter greater 1'))
            .toThrow(/array, sequence or table/);
    });

    it('filters the result of a filter by membership', () => {
        expect(run(`${NUMBERS}Kept = N filter greater 3\nKept filter in (array 2 5 7 11)`)).toBe('5 7');
        expect(run(`${NUMBERS}Kept = N filter greater 3\nKept filter not in (array 5 7)`)).toBe('4 6 8 9 10');
    });

    it('returns a lazy selection for an empty array as for any other', () => {
        expect(run(`${NUMBERS}E = N 10 drop\n(E filter in N) type`)).toBe('.sequence');
        expect(run(`${NUMBERS}E = N 10 drop\n(E filter greater 1) type`)).toBe('.sequence');
        expect(run(`${NUMBERS}Next = N filter in N\nfor I in 0 to 10\n  Rest = N I drop\n  Next = Rest filter in N\nend\nNext len`))
            .toBe('0');
    });
});
