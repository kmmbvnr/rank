import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeValues } from '@arrrank/language';
import { Interpreter, RuntimeDiagnostics, formatValue, parse } from '../src/index.js';
import { type RankArray } from '../src/value.js';

for (const compiled of [true, false]) describe(`array construction (compiled ${compiled})`, () => {
    const runtime = () => {
        const r = new Interpreter(() => {}, { compilation: compiled, integerLoopCompilation: compiled,
            scalarCompilation: compiled, tensorCellCompilation: compiled });
        r.execute('use sequences');
        return r;
    };
    it('rebuilds synchronous items on every execution without sharing mutable results', () => {
        const r = runtime();
        try {
            const program = parse('A = array 1 -2 3\nA');
            const diagnostics = new RuntimeDiagnostics(Infinity, true);
            expect(formatValue(diagnostics.run(() => r.executeProgram(program))!)).toBe('1 -2 3');
            expect(diagnostics.compilerObservations.some(entry => entry.backend === 'native-array-construction'
                && entry.phase === 'execute' && entry.outcome === 'selected')).toBe(true);
            r.execute('A 0 = 99');
            expect(formatValue(r.executeProgram(program)!)).toBe('1 -2 3');
        } finally { r.dispose(); }
    });
    it.each([64, 65])('keeps constructors with %s elements valid across the direct-path budget', count => {
        const r = runtime();
        try {
            const value = r.execute(`array ${Array(count).fill('1').join(' ')}`) as RankArray;
            expect(value.shape).toEqual([count]);
            expect(value.items).toEqual(Array(count).fill(1n));
        } finally { r.dispose(); }
    });
    it('resumes signed constructor items once in source order', () => {
        const output: string[] = [];
        const r = new Interpreter(line => output.push(String(line)), { compilation: compiled });
        try {
            const result = r.execute(`use io
fun N observed
 N print
 return N
end
array (1 observed) -(2 observed) (3 observed)`);
            expect(formatValue(result!)).toBe('1 -2 3');
            expect(output).toEqual(['1', '2', '3']);
        } finally { r.dispose(); }
    });
    it('stops at an operand error before evaluating later items', () => {
        const output: string[] = [];
        const r = new Interpreter(line => output.push(String(line)), { compilation: compiled });
        try {
            expect(() => r.execute(`use io
fun N observed
 N print
 return 10 // N
end
array (1 observed) (0 observed) (2 observed)`)).toThrow();
            expect(output).toEqual(['1', '0']);
        } finally { r.dispose(); }
    });
    it('checks the element contract after evaluating all constructor items', () => {
        const output: string[] = [];
        const r = new Interpreter(line => output.push(String(line)), { compilation: compiled });
        try {
            expect(() => r.execute(`use io
fun N observed
 N print
 return N
end
array (1 observed) "bad" (2 observed)`)).toThrow();
            expect(output).toEqual(['1', '2']);
        } finally { r.dispose(); }
    });
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
    it('checks deferred shapes without reading cells and completes ordinary storage before writes', () => {
        const r = runtime();
        let reads = 0;
        const lazy: RankArray = { kind: 'array', shape: [2], items: [],
            itemAt: index => { reads++; return BigInt(index + 1); } };
        r.variables.set('Lazy', lazy);
        r.execute("M' = array Lazy Lazy");
        expect(reads).toBe(0);
        expect(formatValue(r.execute('M shape')!)).toBe('2 2');
        expect(reads).toBe(0);
        expect(r.execute('M 1 0')).toBe(1n);
        expect(reads).toBe(1);
        r.execute('Saved = M');
        expect(reads).toBe(5);
        expect(r.execute('Saved 1 0')).toBe(1n);
        expect(reads).toBe(5);
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
