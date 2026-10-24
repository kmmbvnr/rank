import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankArray } from '../src/index.js';
import { booleanCells, denseScalarItems, typedArray, ownedArray } from '../src/array-storage.js';
import { reshapeWithDimensions } from '../src/modules/sequences.js';

describe('typed reshape storage', () => {
    it.each([new BigInt64Array([1n, 2n, 3n, 4n]), new Float64Array([1, 2, 3, 4])])(
        'shares storage and detaches Rank writes through either shape: %s', buffer => {
            const source = typedArray(buffer);
            const reshaped = reshapeWithDimensions(source, [2n, 2n]) as RankArray;
            expect(denseScalarItems(reshaped)).toBe(denseScalarItems(source));
            const runtime = new Interpreter();
            const real = buffer instanceof Float64Array;
            runtime.variables.set('A', source);
            runtime.variables.set('B', reshaped);
            try {
                runtime.execute(`A 0 = ${real ? '9.0' : '9'}`);
                expect(formatValue(runtime.execute('B')!)).toBe('1 2 3 4');
                runtime.execute(`B 1 1 = ${real ? '8.0' : '8'}`);
                expect(formatValue(runtime.execute('A')!)).toBe('9 2 3 4');
                expect(formatValue(runtime.execute('B')!)).toBe('1 2 3 8');
            } finally { runtime.dispose(); }
        });
});

describe('boxed reshape storage', () => {
    it.each([[1n, 2n, 3n, 4n], [1.5, 2.5, 3.5, 4.5],
        [true, false, true, false], ['a', 'b', 'c', 'd']])(
        'shares scalar cells and isolates Rank writes: case %#', (...values) => {
            const source = ownedArray(values);
            const shaped = reshapeWithDimensions(source, [2n, 2n]) as RankArray;
            if (typeof values[0] === 'boolean') expect(booleanCells(shaped)).toBe(booleanCells(source));
            else expect(denseScalarItems(shaped)).toBe(denseScalarItems(source));
            const runtime = new Interpreter();
            runtime.variables.set('A', source);
            runtime.variables.set('B', shaped);
            try {
                runtime.execute('A 0 = A 1\nB 1 1 = B 0 0');
                expect(formatValue(runtime.execute('A')!)).toBe(values.map((v, i) => formatValue(i === 0 ? values[1] : v)).join(' '));
                expect(formatValue(runtime.execute('B')!)).toBe(values.map((v, i) => formatValue(i === 3 ? values[0] : v)).join(' '));
            } finally { runtime.dispose(); }
        });

    it('isolates Rank writes and preserves repeatedly reshaped aliases', () => {
        const runtime = new Interpreter();
        try {
            runtime.execute(`use sequences
A = array true false true false
B = A reshape 2 2
C = B reshape 4
A 0 = false
B 1 1 = true`);
            expect(formatValue(runtime.execute('A')!)).toBe('false false true false');
            expect(formatValue(runtime.execute('B')!)).toBe('true false true true');
            expect(formatValue(runtime.execute('C')!)).toBe('true false true false');
        } finally { runtime.dispose(); }
    });
});

for (const compilation of [false, true]) describe(`inferred reshape (compiled=${compilation})`, () => {
    function run(source: string) {
        const runtime = new Interpreter(undefined, { compilation });
        try { return runtime.execute('use sequences\n' + source); }
        finally { runtime.dispose(); }
    }

    it.each([
        ['# 1', [6, 1]], ['1 #', [1, 6]], ['2 #', [2, 3]],
        ['#', [6]], ['1 # 2', [1, 3, 2]],
    ])('infers %s from all tensor elements', (shape, expected) => {
        const value = run(`A = (array 1 2 3 4 5 6) reshape 2 3\nA reshape ${shape}`);
        expect(value).toMatchObject({ shape: expected });
        expect(formatValue(value!)).toBe('1 2 3 4 5 6');
    });

    it('supports dynamic dimensions, unpacking and following operations', () => {
        expect(formatValue(run('N = 2\n(1 to 6) reshape N # shape')!)).toBe('2 3');
        expect(formatValue(run('Dims = array 1 2\n(1 to 6) reshape unpack Dims # shape')!)).toBe('1 2 3');
    });

    it('handles empty sources and rejects ambiguous zero dimensions', () => {
        expect(run('(array shape 0 fill 0) reshape # 1')).toMatchObject({ shape: [0, 1] });
        expect(run('(array shape 0 fill 0) reshape 2 #')).toMatchObject({ shape: [2, 0] });
        expect(() => run('(array shape 0 fill 0) reshape # 0')).toThrow('another dimension is zero');
        expect(() => run('(array 1) reshape 0 #')).toThrow('another dimension is zero');
    });

    it('counts Unicode text and consumes a generator only once', () => {
        expect(run('"A😀БC" reshape # 2')).toMatchObject({ shape: [2, 2] });
        expect(formatValue(run(`fun values
 yield 1
 yield 2
 yield 3
 yield 4
end
S = values
S reshape 2 #`)!)).toBe('1 2 3 4');
    });

    it('rejects invalid dimensions and infinite sources', () => {
        expect(() => run('(1 to 5) reshape 2 #')).toThrow('cannot divide 5');
        expect(() => run('(1 to 6) reshape # #')).toThrow('at most one');
        expect(() => run('(1 to 6) reshape -1 2')).toThrow('must be nonnegative');
        expect(() => run('fibonacci reshape # 1')).toThrow('requires a finite sequence');
        expect(() => run('(1 to 6) reshape # 1.5')).toThrow('dimensions must be integers');
        expect(() => run('(1 to 6) reshape # 9007199254740992')).toThrow('dimension is too large');
        expect(() => run('(1 to 6) reshape # 9007199254740991 9007199254740991')).toThrow('cannot divide 6');
    });

    it('preserves addressing and vector transpose', () => {
        expect(formatValue(run('A = (1 to 6) reshape 2 3\n(A # 1) reshape # 1')!)).toBe('2 5');
        expect(run('(array 1 2 3) transpose')).toMatchObject({ shape: [3] });
        expect(() => run('#')).toThrow('# is only valid');
    });
});
