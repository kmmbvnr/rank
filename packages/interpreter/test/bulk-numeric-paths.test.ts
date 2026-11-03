import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { prepareStoredScalarView } from '../src/integer-view.js';

for (const compilation of [false, true]) describe(`bulk numeric paths (compilation=${compilation})`, () => {
    const run = (source: string): string => {
        const runtime = new Interpreter(() => {}, { compilation });
        try { return formatValue(runtime.execute('use sequences\n' + source)!); }
        finally { runtime.dispose(); }
    };

    describe('concat of mixed integer widths', () => {
        const wide = 'W = (0 till 200 array) * 1000000007 * 1000000007 mod 4000000000000000000';

        it('joins a packed cell, a wide array and a nested rope in order', () => {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(`use sequences
${wide}
Z = array shape 1 fill 5
E = array shape 0 fill 0
for Q in 0 till 3 array
  E = concat E (concat Z W)
end`);
                const view = prepareStoredScalarView(runtime.variables.get('E')!, true)!;
                expect((view.compact ?? view.items).constructor.name).toBe('BigInt64Array');
                runtime.execute(`D1 = E (1 till 201 array) - W
D3 = E (403 till 603 array) - W`);
                expect(formatValue(runtime.execute('array (E len) (E 0) (E 201) (E 402) (D1 reduce max) (D3 reduce min)')!))
                    .toBe('603 5 5 5 0 0');
            } finally { runtime.dispose(); }
        });

        it('keeps a packed prefix equal to its widened value', () => {
            expect(run(`${wide}
E = concat (array shape 3 fill -7) W
array (E 0) (E 2) (E 3) (E len) (E reduce min)`)).toBe('-7 -7 0 203 -7');
        });

        it('rejects nothing when a source changes after joining', () => {
            expect(run(`${wide}
A = array shape 70 fill 1
B = concat A W
A 0 = 99
array (B 0) (B 69) (B 70) (A 0)`)).toBe('1 1 0 99');
        });
    });

    describe('real selection writes', () => {
        it('writes contiguous, strided and reverse ranges of a real array', () => {
            expect(run(`E = array shape 100 fill 0.0
E (10 till 20 array) = (0 till 10 array) * 0.5
E (50 to 90 by 10 array) = 1.25 * (1 to 5 array)
E (99 to 95 by -2 array) = 3.5 + (0 till 3 array)
array (E 10) (E 19) (E 50) (E 90) (E 99) (E 97) (E 95) (E 0) (E reduce max)`))
                .toBe('0 4.5 1.25 6.25 3.5 4.5 5.5 0 6.25');
        });

        it('snapshots an overlapping right side before writing', () => {
            expect(run(`E = (0 till 100 array) * 1.0
E (1 till 100 array) = E (0 till 99 array)
array (E 0) (E 1) (E 2) (E 99)`)).toBe('0 0 1 98');
        });

        it('lets the last repeated index win and keeps an integer array exact', () => {
            expect(run(`I = array shape 100 fill 0
I (0 till 3 array) = 7 to 9 array
I 2`)).toBe('9');
            expect(run(`E = array shape 100 fill 0.0
Ix = array shape 3 fill 5
Ix 2 = 7
Vs = (1 to 3 array) + 0.5
E Ix = Vs
array (E 5) (E 7) (E 4)`)).toBe('2.5 3.5 0');
        });

        it('rejects a real cell written into an integer array', () => {
            expect(() => run(`I = array shape 100 fill 0
I (0 till 3 array) = array 1.5 2.5 3.5`)).toThrow();
        });

        it('reads back written cells through sums and further writes', () => {
            expect(run(`E = array shape 128 fill 0.0
E (0 till 64 array) = 0.25
E (64 till 128 array) = 0.5
E (32 till 96 array) = 1.0
array (E sum) (E 31) (E 32) (E 95) (E 96)`)).toBe('88 0.25 1 1 0.5');
        });
    });

    describe('shift of stored integers', () => {
        it('matches the lazy reader for every amount and keeps its source apart', () => {
            expect(run(`V = 5 to 104 array
A = V shift 1
B = V shift -3
C = V shift 250
D = V shift -250
V 0 = 0
array (A 0) (A 1) (A 99) (B 0) (B 96) (B 97) (C 99) (D 0) (A sum) (V 0)`))
                .toBe('0 5 103 8 104 0 0 0 5346 0');
        });

        it('shifts a matrix along each axis', () => {
            expect(run(`M = (1 to 12 array) reshape 3 4
P = M shift 1
Q = M shift -1 axis 1
array (P 0 0) (P 1 0) (P 2 3) (Q 0 0) (Q 0 3) (Q 2 2)`)).toBe('0 1 8 2 0 12');
        });

        it('leaves reals and non-zero fills on the ordinary reader', () => {
            expect(run(`V = 1 to 100 array
B = V shift 2 with -1
array (B 0) (B 1) (B 2)`)).toBe('-1 -1 1');
            expect(run(`R = (1 to 100 array) * 0.5
A = R shift 1 with 0.0
A 1`)).toBe('0.5');
            expect(run('R = (1 to 100 array) * 0.5\nA = R shift 1 with 0.0\nA 99')).toBe('49.5');
        });
    });

    describe('real fill', () => {
        it('stores a large finite fill as reals and still accepts writes', () => {
            expect(run(`E = array shape 1000 fill 0.5
E 3 = 2.25
array (E sum) (E 3) (E 999)`)).toBe('501.75 2.25 0.5');
        });
    });
});
