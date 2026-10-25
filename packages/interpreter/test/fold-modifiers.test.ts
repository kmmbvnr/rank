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

describe('reduction input cells', () => {
    it.each(['+', 'plus'])('combines complete rows with %s, with optional seeds', operation => {
        expect(result(matrix + plus + `M reduce ${operation} rank 1 axis 0`))
            .toEqual({ text: '5 7 9', shape: [3] });
        expect(result(matrix + plus + `M reduce ${operation} rank 1 axis 0 with (array 10 20 30)`))
            .toEqual({ text: '15 27 39', shape: [3] });
    });

    it.each([true, false])('uses ordinary function application for row callbacks (compiled=%s)', compiled => {
        const runtime = new Interpreter(() => {}, { scalarCompilation: compiled, integerLoopCompilation: compiled,
            tensorCellCompilation: compiled });
        try {
            runtime.execute(matrix + 'use numbers\ncombine = gcd\n');
            expect(formatValue(runtime.execute('M reduce combine rank 1 axis 0')!)).toBe('1 1 3');
            expect(formatValue(runtime.execute('(M 0) gcd (M 1)')!)).toBe('1 1 3');
            expect(formatValue(runtime.execute('M reduce min rank 1 axis 0')!)).toBe('1 2 3');
            expect(formatValue(runtime.execute('M reduce max rank 1 axis 0')!)).toBe('4 5 6');
        } finally { runtime.dispose(); }
    });

    it('stacks array accumulators even when the input cells are scalars', () => {
        const source = matrix + 'fun Acc append Item = concat Acc (array Item)\n';
        expect(result(source + 'M reduce append rank 0 axis 1 with (array shape 0 fill 0)'))
            .toEqual({ text: '1 2 3 4 5 6', shape: [2, 3] });
        expect(result(matrix + 'M reduce + axis 1 with (array 10 20)'))
            .toEqual({ text: '16 26 25 35', shape: [2, 2] });
    });

    it('keeps batches independent and accepts scalar accumulators for row inputs', () => {
        const source = 'use sequences\nT = (1 to 12) reshape 2 2 3\n';
        expect(result(source + 'T reduce + rank 1 axis 1'))
            .toEqual({ text: '5 7 9 17 19 21', shape: [2, 3] });
        expect(result(source + 'fun Acc total Row = Acc + (Row sum)\nT reduce total rank 1 axis 1 with 0'))
            .toEqual({ text: '21 57', shape: [2] });
    });

    it('folds matrix cells, preserves aliases and traverses multiple axes in source order', () => {
        const source = 'use sequences\nT = (1 to 8) reshape 2 2 2\n' + plus + 'combine = plus\n';
        expect(result(source + 'T reduce combine rank 2 axis 0'))
            .toEqual({ text: '6 8 10 12', shape: [2, 2] });
        expect(result(source + digits + 'T reduce digits rank 1 axis 1 0'))
            .toEqual({ text: '1357 2468', shape: [2] });
        expect(result(source + digits + 'T reduce digits axis 0 1 rank 1'))
            .toEqual({ text: '1357 2468', shape: [2] });
    });

    it('handles empty traversal, empty cells and empty frames without inventing callback calls', () => {
        expect(result('E = array shape 0 3 fill 0\nE reduce + rank 1 axis 0'))
            .toEqual({ text: '0 0 0', shape: [3] });
        expect(result(plus + 'E = array shape 0 3 fill 0\nE reduce plus rank 1 axis 0 with (array 7 8)'))
            .toEqual({ text: '7 8', shape: [2] });
        expect(() => run(plus + 'E = array shape 0 3 fill 0\nE reduce plus rank 1 axis 0')).toThrow(/initial value/);
        expect(result('E = array shape 2 0 fill 0\nE reduce + rank 1 axis 0'))
            .toEqual({ text: '', shape: [0] });
        expect(result('E = array shape 0 2 3 fill 0\nE reduce + rank 1 axis 1'))
            .toEqual({ text: '', shape: [0, 3] });
        expect(result('E = array shape 0 2 3 fill 0\nE reduce + rank 1 axis 1 with 7'))
            .toEqual({ text: '', shape: [0] });
    });

    it.each(['M reduce + rank 1 axis 0 1', 'M reduce plus rank 2 axis 0'])
        ('rejects too many traversal and cell axes: %s', expression => {
            expect(() => run(matrix + plus + expression)).toThrow(/axis count exceeds/);
        });

    it('solves the triangle using neighbouring elements within whole rows', () => {
        const source = `use sequences
T = array shape 5 5
 1 0 0 0 0
 2 3 0 0 0
 4 5 6 0 0
 1 2 3 4 0
 9 1 2 3 4
end
fun Low pick Up = Up + (Low max (concat (Low drop 1) (array 0)))
Rev = T reverse axis 0
`;
        expect(run(source + 'Best = Rev reduce pick rank 1 axis 0\nBest 0')).toBe('18');
        expect(run(source + 'Best = (Rev drop 1) reduce pick rank 1 axis 0 with (Rev 0)\nBest 0')).toBe('18');
    });
});

describe('orthogonal fold modifiers', () => {
    it.each(['+', 'plus'])('reduces %s over ranked cells and arbitrary axes', operation => {
        expect(result(matrix + plus + `M reduce ${operation} axis 1 with 10`)).toEqual({ text: '16 25', shape: [2] });
        expect(result(matrix + plus + `M reduce ${operation} axis 0 with 10`)).toEqual({ text: '15 17 19', shape: [3] });
        expect(result(matrix + plus + `M reduce ${operation} axis 1 0 with 10`)).toEqual({ text: '31', shape: [] });
        expect(result(matrix + plus + `M reduce ${operation} axis 0 1 with 10`)).toEqual({ text: '31', shape: [] });
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
        expect(result(source + `M scan ${operation} axis 1 with ${seed}`)).toEqual({ text: scanned, shape: [2, 4] });
    });

    it('uses row-major order independently of the axis list order', () => {
        expect(run(matrix + digits + 'M reduce digits axis 1 0 with 0')).toBe('123456');
        expect(run(matrix + 'M reduce - axis 1 0 with 100')).toBe('79');
    });

    it.each(['+', 'plus'])('scans %s along scalar axes', operation => {
        const source = matrix + plus;
        expect(result(source + `M scan ${operation} axis 1 with 0`)).toEqual({ text: '0 1 3 6 0 4 9 15', shape: [2, 4] });
        expect(result(source + `M scan ${operation} axis 0 with 0`)).toEqual({ text: '0 0 0 1 2 3 5 7 9', shape: [3, 3] });
        expect(result(source + `M scan ${operation} rank 0 axis 0 with 0`)).toEqual(result(source + `M scan ${operation} axis 0 with 0`));
        expect(result(source + `M scan ${operation} axis 1`)).toEqual({ text: '1 3 6 4 9 15', shape: [2, 3] });
    });

    it('uses named builtins and preserves a following pipeline', () => {
        expect(run(matrix + 'M reduce * axis 1 max')).toBe('120');
        expect(run(matrix + 'M reduce * axis 1 min')).toBe('6');
        expect(run(matrix + 'M reduce min axis 1')).toBe('1 4');
        expect(run(matrix + 'M reduce max axis 0 with 10')).toBe('10 10 10');
        expect(run(matrix + 'M scan min axis 1 with 9')).toBe('9 1 1 1 9 4 4 4');
        expect(run(matrix + plus + 'M scan plus axis 1 with (1 + 1) shape')).toBe('2 4');
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
        expect(run(source + 'Totals = M reduce next axis 1 with Start\n(Totals 1) .total')).toBe('15');
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
        expect(result(source + `E scan ${operation} axis 2 with 7`)).toEqual({ text: '', shape: [2, 0, 4] });
        expect(result(source + `E scan ${operation} axis 1`)).toEqual({ text: '', shape: [2, 0, 3] });
        expect(result(source + `E reduce ${operation} axis 2`)).toEqual({ text: '', shape: [2, 0] });
    });

    it('retains symbolic identities and requires seeds for empty named folds', () => {
        const source = matrix + plus + 'E = array shape 2 0 fill 0\n';
        expect(run(source + 'E reduce + axis 1')).toBe('0 0');
        expect(() => run(source + 'E reduce plus axis 1')).toThrow(/initial value/);
        expect(() => run(source + 'E reduce - axis 1')).toThrow(/empty cell/);
    });

    it('retains rank-one sequences and scalar rank-zero reductions', () => {
        expect(run(plus + '(1 to 3) scan plus with 0')).toBe('0 1 3 6');
        expect(run("use sequences\nPrefix' = primes scan + with 0\nPrefix 4")).toBe('17');
        expect(run(plus + '7 reduce plus with 10')).toBe('17');
        expect(run('7 reduce + with 10')).toBe('17');
    });

    it.each([
        'M reduce + axis 1 axis 0', 'M reduce plus axis 0 axis 1',
        'M scan + rank 2 axis 1', 'M scan plus axis 0 1', 'M scan + axis 0 1',
        'M reduce plus axis 0 0', 'M reduce + axis 2', 'M reduce plus rank 3',
        'M scan + rank 0', 'M scan plus rank 3', 'M scan + axis -3',
        'M scan plus rank 1 axis 0 with (array 1 2)',
    ])('rejects invalid modifiers: %s', expression => {
        expect(() => run(matrix + plus + expression)).toThrow();
    });
});

describe('scan input cells', () => {
    it.each(['+', 'plus', 'max'])('scans rows with %s, explicit or inferred axis and seed', operation => {
        const prefix = matrix + plus;
        const end = operation === 'max' ? '4 5 6' : '5 7 9';
        expect(result(prefix + `M scan ${operation} rank 1 axis 0`))
            .toEqual({ text: `1 2 3 ${end}`, shape: [2, 3] });
        expect(result(prefix + `M scan ${operation} rank 1 axis 0`))
            .toEqual(result(prefix + `M scan ${operation} axis -2 rank 1`));
        expect(result(prefix + `M scan ${operation} rank 1 axis 0 with (array 0 0 0)`))
            .toEqual({ text: `0 0 0 1 2 3 ${end}`, shape: [3, 3] });
    });

    it.each([true, false])('uses normal callback application and aliases (compiled=%s)', compiled => {
        const runtime = new Interpreter(() => {}, { scalarCompilation: compiled, integerLoopCompilation: compiled,
            tensorCellCompilation: compiled });
        try {
            runtime.execute(matrix + 'use numbers\ncombine = gcd\n');
            expect(formatValue(runtime.execute('M scan combine rank 1 axis 0')!)).toBe('1 2 3 1 1 3');
        } finally { runtime.dispose(); }
    });

    it('returns all triangle states and the same last row as reduce', () => {
        const source = `use sequences
T = array shape 5 5
 1 0 0 0 0
 2 3 0 0 0
 4 5 6 0 0
 1 2 3 4 0
 9 1 2 3 4
end
fun Low pick Up = Up + (Low max (concat (Low drop 1) (array 0)))
Rev = T reverse axis 0
`;
        expect(result(source + 'Rev scan pick rank 1 axis 0')).toEqual({ shape: [5, 5],
            text: '9 1 2 3 4 10 4 6 8 4 14 11 14 8 4 16 17 14 8 4 18 17 14 8 4' });
        expect(result(source + '(Rev drop 1) scan pick rank 1 axis 0 with (Rev 0)'))
            .toEqual(result(source + 'Rev scan pick rank 1 axis 0'));
    });

    it('preserves the position of traversal axes among independent batches', () => {
        const source = 'use sequences\nT = (1 to 12) reshape 2 2 3\n' + digits;
        expect(result(source + 'T scan digits rank 1 axis 0')).toEqual({ shape: [2, 2, 3],
            text: '1 2 3 4 5 6 17 28 39 50 61 72' });
        expect(result(source + 'T scan digits rank 1 axis 1')).toEqual({ shape: [2, 2, 3],
            text: '1 2 3 14 25 36 7 8 9 80 91 102' });
        expect(result(source + 'T scan + rank 2 axis 0')).toEqual({ shape: [2, 2, 3],
            text: '1 2 3 4 5 6 8 10 12 14 16 18' });
        expect(result(source + 'T scan digits rank 1 axis 1 with (array 0 0 0)')).toEqual({ shape: [2, 3, 3],
            text: '0 0 0 1 2 3 14 25 36 0 0 0 7 8 9 80 91 102' });
    });

    it('allows fixed-shape accumulators different from input cells', () => {
        const source = matrix + 'fun Acc total Row = Acc + (Row sum)\n';
        expect(result(source + 'M scan total rank 1 axis 0 with 0')).toEqual({ shape: [3], text: '0 6 21' });
        expect(result(matrix + 'M scan + rank 0 axis 1 with (array 10 20)'))
            .toEqual({ shape: [2, 4, 2], text: '10 20 11 21 13 23 16 26 10 20 14 24 19 29 25 35' });
        expect(() => run(matrix + 'M scan + rank 1 axis 0 with 0')).toThrow(/matching shapes/);
        expect(() => run(matrix + 'fun A grow B = concat A B\nM scan grow rank 1 axis 0')).toThrow(/matching shapes/);
    });

    it('preserves empty traversal, frame and cell dimensions', () => {
        expect(result('E = array shape 0 3 fill 0\nE scan + rank 1 axis 0')).toEqual({ shape: [0, 3], text: '' });
        expect(result('E = array shape 0 3 fill 0\nE scan + rank 1 axis 0 with (array 7 8)'))
            .toEqual({ shape: [1, 2], text: '7 8' });
        expect(result('E = array shape 0 2 3 fill 0\nE scan + rank 1 axis 1 with (array 7 8)'))
            .toEqual({ shape: [0, 3, 2], text: '' });
        expect(result('E = array shape 2 0 fill 0\nE scan + rank 1 axis 0')).toEqual({ shape: [2, 0], text: '' });
    });

    it.each(['reduce', 'scan'])('requires traversal axes for every explicit rank in %s', fold => {
        for (const rank of [0, 1, 2]) expect(() => run(matrix + `M ${fold} + rank ${rank}`)).toThrow(/explicit axis/);
        expect(() => run('T = array shape 2 3 4 fill 1\n' + `T ${fold} + rank 1`)).toThrow(/explicit axis/);
        expect(() => run(matrix + `M ${fold} + rank 2 axis -1`)).toThrow(/axis count exceeds/);
    });
});

it.each([true, false])('evaluates input-cell seeds and callbacks once (seeded=%s)', seeded => {
    const runtime = new Interpreter();
    let calls = 0;
    try {
        runtime.execute(`use sequences
use algo
T = (1 to 12) reshape 2 2 3
Seeds = new queue
fun Q start
 Q push 1
 return array 0 0 0
end
`);
        runtime.variables.set('next', { kind: 'function', name: 'next', arities: [2], monadicRank: 'all',
            dyadicRanks: ['all', 'all'], call: args => { calls++; return args[1]; } });
        runtime.execute(`States = T scan next rank 1 axis 1${seeded ? ' with (Seeds start)' : ''}`);
        runtime.execute('States sum');
        runtime.execute('States sum');
        expect(calls).toBe(seeded ? 4 : 2);
        expect(formatValue(runtime.execute('Seeds len')!)).toBe(seeded ? '1' : '0');
    } finally { runtime.dispose(); }
});

describe('fold cells after removing traversal axes (#454)', () => {
    it.each(['+', 'plus'])('folds columns and nontrailing planes with %s', operation => {
        const source = matrix + plus + 'T = (1 to 24) reshape 2 3 4\n';
        expect(result(source + `M reduce ${operation} rank 1 axis 1`))
            .toEqual({ shape: [2], text: '6 15' });
        expect(result(source + `M scan ${operation} rank 1 axis -1`))
            .toEqual({ shape: [3, 2], text: '1 4 3 9 6 15' });
        expect(result(source + `T reduce ${operation} rank 1 axis 2`))
            .toEqual({ shape: [2, 3], text: '10 26 42 58 74 90' });
        expect(result(source + `T scan ${operation} rank 1 axis 2`))
            .toEqual({ shape: [2, 4, 3], text: '1 5 9 3 11 19 6 18 30 10 26 42 13 17 21 27 35 43 42 54 66 58 74 90' });
        expect(result(source + `T reduce ${operation} rank 2 axis 1`))
            .toEqual({ shape: [2, 4], text: '15 18 21 24 51 54 57 60' });
        expect(result(source + `T scan ${operation} rank 2 axis 1`))
            .toEqual({ shape: [3, 2, 4], text: '1 2 3 4 13 14 15 16 6 8 10 12 30 32 34 36 15 18 21 24 51 54 57 60' });
    });

    it.each([true, false])('passes columns as whole callback cells (compiled=%s)', compiled => {
        const runtime = new Interpreter(() => {}, { scalarCompilation: compiled, integerLoopCompilation: compiled,
            tensorCellCompilation: compiled });
        try {
            runtime.execute(matrix + 'fun A pick B = B\n');
            expect(formatValue(runtime.execute('M reduce pick rank 1 axis 1')!)).toBe('3 6');
            expect(formatValue(runtime.execute('M scan pick rank 1 axis 1')!)).toBe('1 4 2 5 3 6');
        } finally { runtime.dispose(); }
    });

    it('keeps source traversal order and supports multiple axes around a cell', () => {
        const source = 'use sequences\nT = (1 to 12) reshape 2 2 3\n' + digits;
        expect(result(source + 'T scan digits rank 1 axis 2'))
            .toEqual({ shape: [2, 3, 2], text: '1 4 12 45 123 456 7 10 78 111 789 1122' });
        expect(result(source + 'T reduce digits rank 1 axis 2 0'))
            .toEqual({ shape: [2], text: '123789 457122' });
        expect(result(source + 'T reduce digits rank 1 axis 0 -1'))
            .toEqual(result(source + 'T reduce digits rank 1 axis 2 0'));
    });

    it('keeps seed and accumulator shapes independent of column cells', () => {
        const source = matrix + 'fun Acc total Col = Acc + (Col sum)\n';
        expect(result(source + 'M reduce total rank 1 axis 1 with 0')).toEqual({ shape: [], text: '21' });
        expect(result(source + 'M scan total rank 1 axis 1 with 0')).toEqual({ shape: [4], text: '0 5 12 21' });
        expect(result(matrix + 'M scan + rank 1 axis 1 with (array 10 20)'))
            .toEqual({ shape: [4, 2], text: '10 20 11 24 13 29 16 35' });
    });

    it('uses selected cell shapes for empty traversal, frames and cells', () => {
        expect(result('E = array shape 2 0 fill 0\nE reduce + rank 1 axis 1'))
            .toEqual({ shape: [2], text: '0 0' });
        expect(result('E = array shape 2 0 fill 0\nE scan + rank 1 axis 1'))
            .toEqual({ shape: [0, 2], text: '' });
        expect(result('E = array shape 0 3 fill 0\nE scan + rank 1 axis 1'))
            .toEqual({ shape: [3, 0], text: '' });
        expect(result('E = array shape 0 2 3 fill 0\nE reduce + rank 1 axis 2'))
            .toEqual({ shape: [0, 2], text: '' });
        expect(result('E = array shape 0 2 3 fill 0\nE scan + rank 1 axis 2'))
            .toEqual({ shape: [0, 3, 2], text: '' });
        expect(result('E = array shape 2 0 4 fill 0\nE reduce + rank 2 axis 1'))
            .toEqual({ shape: [2, 4], text: '0 0 0 0 0 0 0 0' });
        expect(result('E = array shape 2 0 fill 0\nE scan + rank 1 axis 1 with (array 7 8)'))
            .toEqual({ shape: [1, 2], text: '7 8' });
    });
});

describe('explicit traversal axis for ranked folds', () => {
    it.each(['+', 'plus'])('rejects missing axes for %s on every input kind', operation => {
        for (const fold of ['reduce', 'scan']) {
            for (const source of ['M', '(array 1 2 3)', '(1 to 3)', '"abc"']) {
                for (const rank of [0, 1]) {
                    for (const seed of ['', ' with 0']) {
                        expect(() => run(matrix + plus + `${source} ${fold} ${operation} rank ${rank}${seed}`))
                            .toThrow(`${fold} with rank requires an explicit axis; specify rank R axis N`);
                    }
                }
            }
        }
    });

    it.each(['+', 'plus'])('preserves unranked and explicit-axis folds for %s', operation => {
        expect(run(matrix + plus + `M reduce ${operation}`)).toBe('21');
        expect(run(plus + `(1 to 3) reduce ${operation}`)).toBe('6');
        expect(run(plus + `(1 to 3) scan ${operation}`)).toBe('1 3 6');
        expect(() => run(matrix + plus + `M scan ${operation}`)).toThrow(/rank-1/);
        expect(run(matrix + plus + `M reduce ${operation} axis 1`)).toBe('6 15');
        expect(run(matrix + plus + `M reduce ${operation} rank 0 axis 1`)).toBe('6 15');
        expect(result(matrix + plus + `M scan ${operation} rank 0 axis 1`))
            .toEqual(result(matrix + plus + `M scan ${operation} axis 1`));
        expect(run(matrix + 'M sum rank 1')).toBe('6 15');
    });
});
