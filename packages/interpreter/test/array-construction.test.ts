import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeValues } from '@arrrank/language';
import { Interpreter, formatValue, parse } from '../src/index.js';
import { type RankArray } from '../src/value.js';

for (const compiled of [true, false]) describe(`array construction (compiled ${compiled})`, () => {
    const runtime = () => {
        const r = new Interpreter(() => {}, { integerLoopCompilation: compiled,
            scalarCompilation: compiled, tensorCellCompilation: compiled });
        r.execute('use sequences');
        return r;
    };
    it('stacks equally shaped vectors and matrices in input order', () => {
        const r = runtime();
        r.execute('A = array 1 2 3\nB = array 4 5 6\nM = array A B\nT = array M (M + 10)');
        expect(formatValue(r.execute('M shape')!)).toBe('2 3');
        expect(formatValue(r.execute('T shape')!)).toBe('2 2 3');
        expect(formatValue(r.execute('T')!)).toBe('1 2 3 4 5 6 11 12 13 14 15 16');
        expect(formatValue(r.execute('M 1')!)).toBe('4 5 6');
        expect(formatValue(r.execute('unpack First Second = M\narray First Second')!)).toBe('1 2 3 4 5 6');
    });
    it.each(['array A B', 'array shape 2\n A B\nend'])('rejects differing cell shapes before binding: %s', constructor => {
        const r = runtime();
        r.execute('A = array 1 2\nB = array 3 4 5');
        expect(() => r.execute(`Result = ${constructor}`)).toThrowError(expect.objectContaining({
            rankKind: 'DimensionMismatch',
            message: 'array items must have the same shape: item 0 has shape [2], item 1 has shape [3]',
        }));
        expect(r.variables.has('Result')).toBe(false);
    });
    it.each(['array (array 1 2) 3', 'array 3 (array 1 2)'])('rejects mixed arrays and scalar items: %s', source => {
        expect(() => runtime().execute(source)).toThrowError(expect.objectContaining({ rankKind: 'DimensionMismatch' }));
    });
    it('retains trailing zero dimensions and explicit frame dimensions', () => {
        const r = runtime();
        r.execute('A = array shape 0 3 fill 0\nEmpty = array A A\nV = array 1 2\nFramed = array shape 1 2\n V V\nend');
        expect(formatValue(r.execute('Empty shape')!)).toBe('2 0 3');
        expect(formatValue(r.execute('Framed shape')!)).toBe('1 2 2');
        expect(analyzeValues(parse('V = array 1 2\nFramed = array shape 1 2\n V V\nend')).diagnostics).toEqual([]);
    });
    it('checks shapes without reading lazy cells and preserves named values on writes', () => {
        const r = runtime();
        let reads = 0;
        const lazy: RankArray = { kind: 'array', shape: [2], items: [],
            itemAt: index => { reads++; return BigInt(index + 1); } };
        r.variables.set('Lazy', lazy);
        r.execute('M = array Lazy Lazy');
        expect(reads).toBe(0);
        expect(r.execute('M 1 0')).toBe(1n);
        expect(reads).toBe(1);
        r.execute('A = array 1 2\nB = array A A\nA 0 = 9');
        expect(formatValue(r.execute('B')!)).toBe('1 2 1 2');
        r.execute('B 0 0 = 7');
        expect(formatValue(r.execute('A')!)).toBe('9 2');
        expect(formatValue(r.execute('B')!)).toBe('7 2 1 2');
    });
    it('keeps differently shaped arrays in an explicit tuple', () => {
        const r = runtime();
        r.execute('T = tuple (array 1 2) (array 3 4 5)');
        expect(formatValue(r.execute('T 0')!)).toBe('1 2');
        expect(formatValue(r.execute('T 1')!)).toBe('3 4 5');
    });
    it('runs the Euler 11 solution with separate directional products', () => {
        const r = runtime();
        r.execute(readFileSync(new URL('../../../demos/euler/011_gridproduct.ra', import.meta.url), 'utf8'));
        expect(r.execute('Answer')).toBe(70600674n);
        expect(formatValue(r.execute('array H V D U')!)).toBe('48477312 51267216 40304286 70600674');
    });
});
