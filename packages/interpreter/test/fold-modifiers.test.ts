import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankArray, isNativeFunction } from '../src/index.js';
import { run } from './support.js';

const matrix = 'use sequences\nM = (1 to 6) reshape 2 3\n';
const plus = 'fun A plus B\n return A + B\nend\n';
const digits = 'fun A digits B\n return A * 10 + B\nend\n';
const result = (source: string) => {
    const value = new Interpreter().execute(source)!;
    return { text: formatValue(value), shape: isRankArray(value) ? value.shape : [] };
};

describe('orthogonal fold modifiers', () => {
    it.each(['+', 'plus'])('reduces %s over ranked cells and arbitrary axes', operation => {
        expect(result(matrix + plus + `M reduce ${operation} rank 1 with 10`)).toEqual({ text: '16 25', shape: [2] });
        expect(result(matrix + plus + `M reduce ${operation} axis 0 with 10`)).toEqual({ text: '15 17 19', shape: [3] });
        expect(result(matrix + plus + `M reduce ${operation} axis 1 0 with 10`)).toEqual({ text: '31', shape: [] });
        expect(result(matrix + plus + `M reduce ${operation} rank 0 with 10`)).toEqual({ text: '11 12 13 14 15 16', shape: [2, 3] });
    });

    it.each([
        ['numbers', 'gcd', '0', '1 1 3', '0 1 1 1 0 4 1 1'],
        ['numbers', 'lcm', '1', '4 10 6', '1 1 2 6 1 4 20 60'],
        ['bits', 'band', '-1', '0 0 2', '-1 1 0 0 -1 4 4 4'],
        ['bits', 'bor', '0', '5 7 7', '0 1 3 3 0 4 5 7'],
        ['bits', 'bxor', '0', '5 7 5', '0 1 3 0 0 4 1 7'],
    ])('supports %s.%s with axes, rank and seeds', (module, operation, seed, reduced, scanned) => {
        const source = matrix + `use ${module}\n`;
        expect(run(source + `M reduce ${operation} axis 0 with ${seed}`)).toBe(reduced);
        expect(result(source + `M scan ${operation} rank 1 with ${seed}`)).toEqual({ text: scanned, shape: [2, 4] });
    });

    it('uses row-major order independently of the axis list order', () => {
        expect(run(matrix + digits + 'M reduce digits axis 1 0 with 0')).toBe('123456');
        expect(run(matrix + 'M reduce - axis 1 0 with 100')).toBe('79');
    });

    it.each(['+', 'plus'])('scans %s with the same rank and axis semantics', operation => {
        const source = matrix + plus;
        expect(result(source + `M scan ${operation} rank 1 with 0`)).toEqual({ text: '0 1 3 6 0 4 9 15', shape: [2, 4] });
        expect(result(source + `M scan ${operation} rank 2 with 0`)).toEqual({ text: '0 0 0 1 2 3 5 7 9', shape: [3, 3] });
        expect(result(source + `M scan ${operation} axis 0 with 0`)).toEqual(result(source + `M scan ${operation} rank 2 with 0`));
        expect(result(source + `M scan ${operation} rank 1`)).toEqual({ text: '1 3 6 4 9 15', shape: [2, 3] });
    });

    it('uses named builtins and preserves a following pipeline', () => {
        expect(run(matrix + 'M reduce * rank 1 max')).toBe('120');
        expect(run(matrix + 'M reduce * rank 1 min')).toBe('6');
        expect(run(matrix + 'M reduce min rank 1')).toBe('1 4');
        expect(run(matrix + 'M reduce max axis 0 with 10')).toBe('10 10 10');
        expect(run(matrix + 'M scan min axis 1 with 9')).toBe('9 1 1 1 9 4 4 4');
        expect(run(matrix + plus + 'M scan plus rank 1 with (1 + 1) shape')).toBe('2 4');
        expect(run(matrix + 'M scan + axis 0 with 0 shape')).toBe('3 3');
        expect(run(matrix + plus + 'M reduce plus axis 0 with 10 sum')).toBe('51');
        expect(run(matrix + 'M reduce + axis 0 with 10 sum')).toBe('51');
    });

    it('rechecks the implementation of a builtin before selecting its numeric kernel', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nM = array shape 2 2\n 1.5 2.5\n 3.5 4.5\nend');
            const operation = runtime.execute('max')!;
            if (!isNativeFunction(operation)) throw Error('expected function');
            Object.defineProperty(operation, 'call', { value: () => 77 });
            expect(formatValue(runtime.execute('M scan max axis 0')!)).toBe('1.5 2.5 77 77');
            expect(formatValue(runtime.execute('M scan max axis 0 with 10.0')!)).toBe('10 10 77 77 77 77');
        } finally { runtime.dispose(); }
    });

    it('evaluates a seed once for all lines', () => {
        const source = matrix + 'use algo\nCalls = new queue\nfun Q start\n Q push 1\n return 0\nend\n';
        expect(run(source + 'S = M scan + axis 0 with (Calls start)\nCalls len')).toBe('1');
        expect(run(source + 'R = M reduce + axis 0 with (Calls start)\nCalls len')).toBe('1');
    });

    it('keeps a rank-zero record accumulator independently on each line', () => {
        const source = matrix + 'fun State next Value\n return record\n  .total = State .total + Value\n end\nend\n'
            + 'Start = record\n .total = 0\nend\n';
        expect(run(source + 'States = M scan next axis 0 with Start\n(States 2 2) .total')).toBe('9');
        expect(run(source + 'Totals = M reduce next rank 1 with Start\n(Totals 1) .total')).toBe('15');
    });

    it('scans independent lines of a middle axis', () => {
        expect(result('use sequences\nT = (1 to 8) reshape 2 2 2\n' + digits + 'T scan digits axis 1 with 9'))
            .toEqual({ text: '9 9 91 92 913 924 9 9 95 96 957 968', shape: [2, 3, 2] });
    });

    it.each(['+', 'plus'])('distinguishes empty frames and empty axes for %s', operation => {
        const source = `use sequences\n${plus}E = array shape 2 0 3 fill 0\n`;
        expect(result(source + `E reduce ${operation} axis 1 with 7`)).toEqual({ text: '7 7 7 7 7 7', shape: [2, 3] });
        expect(result(source + `E reduce ${operation} axis 2 with 7`)).toEqual({ text: '', shape: [2, 0] });
        expect(result(source + `E scan ${operation} axis 1 with 7`)).toEqual({ text: '7 7 7 7 7 7', shape: [2, 1, 3] });
        expect(result(source + `E scan ${operation} rank 1 with 7`)).toEqual({ text: '', shape: [2, 0, 4] });
        expect(result(source + `E scan ${operation} axis 1`)).toEqual({ text: '', shape: [2, 0, 3] });
        expect(result(source + `E reduce ${operation} rank 1`)).toEqual({ text: '', shape: [2, 0] });
    });

    it('retains symbolic identities and requires seeds for empty named folds', () => {
        const source = matrix + plus + 'E = array shape 2 0 fill 0\n';
        expect(run(source + 'E reduce + rank 1')).toBe('0 0');
        expect(() => run(source + 'E reduce plus rank 1')).toThrow(/initial value/);
        expect(() => run(source + 'E reduce - axis 1')).toThrow(/empty cell/);
    });

    it('retains rank-one sequences and scalar rank-zero reductions', () => {
        expect(run(plus + '(1 to 3) scan plus rank 1 with 0')).toBe('0 1 3 6');
        expect(run("use sequences\nPrefix' = primes scan + rank 1 with 0\nPrefix 4")).toBe('17');
        expect(run(plus + '7 reduce plus rank 0 with 10')).toBe('17');
        expect(run('7 reduce + rank 0 with 10')).toBe('17');
    });

    it.each([
        'M reduce + rank 1 axis 0', 'M reduce plus axis 0 rank 1',
        'M scan + rank 1 axis 0', 'M scan plus axis 0 1', 'M scan + axis 0 1',
        'M reduce plus axis 0 0', 'M reduce + axis 2', 'M reduce plus rank 3',
        'M scan + rank 0', 'M scan plus rank 3', 'M scan + axis -1',
        'M scan plus axis 0 with (array 1 2)',
    ])('rejects invalid modifiers: %s', expression => {
        expect(() => run(matrix + plus + expression)).toThrow();
    });
});
