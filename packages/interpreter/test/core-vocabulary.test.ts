import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

for (const compiled of [true, false]) {
    describe(`core vocabulary (compiled=${compiled})`, () => {
        function runtime() {
            return new Interpreter(() => undefined, {
                scalarCompilation: compiled, scalarEntryCompilation: compiled,
                scalarFunctionCompilation: compiled, blockCompilation: compiled,
                integerLoopCompilation: compiled, tensorFusion: compiled,
            });
        }

        it('combines ranges, reductions, indexing and loops without imports', () => {
            const r = runtime();
            expect(r.execute('1 to 5 sum')).toBe(15n);
            expect(r.execute('1 until 5 len')).toBe(4n);
            expect(r.execute('9 to 1 by -2 min')).toBe(1n);
            expect(r.execute('3 max 5 min 4')).toBe(4n);
            expect(r.execute('A = array 1 4 2\nA sum + (A len)')).toBe(10n);
            expect(r.execute('Best = 0\nfor I in 1 to 5\n Best = Best max I\nend\nBest')).toBe(5n);
        });

        it('supports tensor axes and ranked reductions without sequence imports', () => {
            const r = runtime();
            r.execute('A = array shape 2 3\n 1 2 3\n 4 5 6\nend');
            expect(r.execute('A len axis 1')).toBe(3n);
            expect(formatValue(r.execute('A sum axis 1')!)).toBe('6 15');
            expect(formatValue(r.execute('A max rank 1')!)).toBe('3 6');
            expect(r.execute('(A * A) sum')).toBe(91n);
        });

        it('preserves user overrides and function aliases', () => {
            const r = runtime();
            r.execute('Total = sum');
            expect(r.execute('1 to 3 Total')).toBe(6n);
            r.execute('fun sum Values\n return 99\nend');
            expect(r.execute('1 to 3 sum')).toBe(99n);
            expect(r.execute('1 to 3 Total')).toBe(6n);
            r.execute('fun max A B\n return A + B\nend');
            expect(r.execute('3 max 4')).toBe(7n);
        });

        it('keeps specialized number and sequence operations behind imports', () => {
            const r = runtime();
            expect(() => r.execute('9 sqrt')).toThrow('use numbers');
            expect(() => r.execute('6 multiple by 3')).toThrow('use numbers');
            expect(() => r.execute('fibonacci')).toThrow('use sequences');
            expect(r.execute('use numbers\n9 sqrt')).toBe(3);
            expect(r.execute('use sequences\nfibonacci until 10 sum')).toBe(19n);
        });

        it('gates each CLI construct and keeps ordinary files parameterless', () => {
            for (const source of ['option N integer = 3', 'argument N integer = 3', 'flag Verbose', 'args "--n" "7"']) {
                expect(() => runtime().execute(source)).toThrow(`${source.split(' ')[0]} requires: use cli`);
                expect(() => runtime().execute(`use cli\n${source}`)).not.toThrow();
            }
            expect(() => new Interpreter(() => undefined, { args: ['7'] }).execute('42'))
                .toThrow('unexpected arguments: 7');
            expect(new Interpreter(() => undefined, { args: ['--n', '7'] })
                .execute('use cli\noption N integer = 3\nN')).toBe(7n);
            const r = runtime();
            r.execute('use cli');
            expect(r.execute('option N integer = 3\nN')).toBe(3n);
        });

        it('retains testing imports and gives source modules the same core', () => {
            expect(() => runtime().execute('test "ok"\n true\nend')).toThrow('use testing');
            const r = runtime();
            r.execute('use testing\ntest "sum"\n 1 to 3 sum equal 6\nend');
            expect(r.testResults[0].passed).toBe(true);
            const imported = new Interpreter(() => undefined, {
                loadModule: () => ({ id: 'worker', source: 'fun total\n return 1 to 3 sum\nend' }),
            });
            expect(imported.execute('use "worker" as W\nW.total')).toBe(6n);
        });
    });
}
