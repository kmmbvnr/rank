import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, parse, RankError, isNativeFunction } from '../src/index.js';

for (const compiled of [true, false]) describe(`expression grouping (compiled: ${compiled})`, () => {
    const run = (source: string) => formatValue(new Interpreter(() => {}, { scalarCompilation: compiled, blockCompilation: compiled, integerLoopCompilation: compiled, tensorFusion: compiled }).execute(
        'use numbers\nuse sequences\nuse stats\n' + source,
    )!);

    it('applies a suffix to the accumulated formula with mathematical precedence', () => {
        expect(run('2 + 9 sqrt')).toBe(String(Math.sqrt(11)));
        expect(run('2 + 3 * 4')).toBe('14');
        expect(run('2 + 3 * 4 sqrt')).toBe(String(Math.sqrt(14)));
        expect(run('2 ** 3 ** 2')).toBe('512');
        expect(run('-2 ** 2')).toBe('-4');
        expect(run('2 + 9 sqrt + 1')).toBe(String(Math.sqrt(11) + 1));
        expect(run('2 + 9 3 gcd')).toBe('1');
        expect(run('2 + 9 type')).toBe('.integer');
    });

    it('finishes a range, including its step, before reduction or materialization', () => {
        expect(run('fibonacci until 1000 sum')).toBe('2582');
        expect(run('Fibs = fibonacci multiple by 5 or fibonacci multiple by 3\n(fibonacci Fibs) until 1000 sum')).toBe('1825');
        expect(run('1 to 9 by 2 sum')).toBe('25');
        expect(run('1 to 9 by 2 array')).toBe('1 3 5 7 9');
        expect(run('1 to 5 + reduce')).toBe('15');
        expect(run('A = array 1 2 3\nA * A + reduce')).toBe('14');
    });

    it('keeps addressing tight and allows explicit smaller operands', () => {
        expect(run('A = array 2 4\nB = array 3 5\nA 1 * B 0')).toBe('12');
        expect(run('A = array 2 4\nA - (A mean)')).toBe('-1 1');
        expect(run('A = array 2 4\nA max + 1')).toBe('5');
        expect(run('A = array 2 4\nA * A mean round 1')).toBe('10');
        expect(run('M = array shape 2 2\n 1 7 4 2\nend\n2 + M 0 max axis 0')).toBe('9');
    });

    it('explains implicit addressing while preparing a postfix call', () => {
        const source = 'A = array 1 2 3\nfun add X Y\n return X + Y\nend\n';
        expect(run(source + 'A copy A add')).toBe('2 4 6');
        expect(run(source + 'A copy (A copy) add')).toBe('2 4 6');
        expect(run(source + 'Indices = array 2 0\nA Indices copy')).toBe('3 1');
        expect(run(source + 'Indices = array 2 0\nA copy Indices copy')).toBe('3 1');
        try {
            run(source + 'A copy A copy add');
            throw new Error('expected rejection');
        } catch (error) {
            expect(error).toBeInstanceOf(RankError);
            expect((error as RankError).rankKind).toBe('Missing');
            expect((error as RankError).message).toContain('array index out of bounds on axis 0: 3');
            expect((error as RankError).message).toContain('While preparing arguments for copy');
            expect((error as RankError).message).toContain('receiver and its selectors');
            expect((error as RankError).message).toContain('group each argument with parentheses');
        }
    });

    it('explains the same addressing error across separate REPL inputs', () => {
        const runtime = new Interpreter(() => {}, { scalarCompilation: compiled, blockCompilation: compiled, integerLoopCompilation: compiled, tensorFusion: compiled });
        runtime.execute('use sequences');
        runtime.execute('A = array 1 2 3');
        runtime.execute('fun add X Y\n return X + Y\nend');
        expect(() => runtime.execute('A copy A copy add')).toThrowError('While preparing arguments for copy');
        expect(formatValue(runtime.execute('A copy (A copy) add')!)).toBe('2 4 6');
    });

    it('applies calls after a comparison to its result and keeps logical clauses independent', () => {
        const arrays = 'A = array 1 2\nB = array 1 3\n';
        // After a bare left operand, a call applies to the comparison's result.
        expect(run(arrays + 'A equal B count')).toBe('1');
        expect(run(arrays + '(A equal B) count')).toBe('1');
        expect(run('use numbers\nC = array 1 2 3 4\nC greater 2 sum')).toBe('7');
        expect(run('use numbers\nC = array 1 2 3 4\nC + 1 greater 3 sum')).toBe('9');
        // A pipeline on the left keeps both sides independent.
        expect(run(arrays + 'A len equal B len')).toBe('true');
        expect(run(arrays + 'B len equal 2')).toBe('true');
        expect(run('use numbers\nC = array 1 2 3 4\nMask = C even or C greater 3\nMask sum')).toBe('6');
        expect(run('not 2 even')).toBe('false');
        expect(run('not 2 less 3')).toBe('false');
        expect(run('not 2 even or 3 odd')).toBe('true');
        expect(run('L = array 1 2 3\nnot 5 in L')).toBe('true');
        expect(run('use text\nT = "hello"\nnot T "he" startswith')).toBe('false');
        expect(run('(1 equal 2) equal false')).toBe('true');
    });

    it('groups user functions and aliases without depending on the input values', () => {
        expect(run('fun twice X\n return X * 2\nend\n2 + 9 twice')).toBe('22');
        expect(run('Root = sqrt\n2 + 9 Root')).toBe(String(Math.sqrt(11)));
        expect(run('Op = gcd\n2 + 9 3 Op')).toBe('1');
        expect(run('fun pair A B\n return A * 10 + B\nend\n2 + 9 3 pair')).toBe('113');
        const interpreter = new Interpreter(() => {}, { scalarCompilation: compiled, blockCompilation: compiled, integerLoopCompilation: compiled, tensorFusion: compiled });
        interpreter.execute('use numbers\nRoot = sqrt');
        expect(formatValue(interpreter.execute('2 + 9 Root')!)).toBe(String(Math.sqrt(11)));
        expect(formatValue(interpreter.execute('Alias = Root\n2 + 9 Alias')!)).toBe(String(Math.sqrt(11)));
        interpreter.execute('Op = gcd');
        expect(formatValue(interpreter.execute('2 + 9 3 Op')!)).toBe('1');
    });

    it('requires explicit grouping for a dynamic function parameter', () => {
        // A function must itself follow data when passed through the host API.
        const runtime = new Interpreter(() => {}, { scalarCompilation: compiled });
        runtime.execute('use numbers\nfun apply Op\n return 2 + 9 Op\nend');
        const root = runtime.execute('sqrt');
        const apply = runtime.variables.get('apply');
        if (!apply || !isNativeFunction(apply) || root === undefined) throw new Error('expected function');
        expect(() => apply.call([root])).toThrowError('Group its input');
        runtime.execute('fun grouped Op\n return (2 + 9) Op\nend');
        const grouped = runtime.variables.get('grouped');
        if (!grouped || !isNativeFunction(grouped)) throw new Error('expected function');
        expect(formatValue(grouped.call([root]))).toBe(String(Math.sqrt(11)));
    });

    it('uses the same extrema arguments for builtins and their aliases', () => {
        const source = 'A = array 1 8\nOp = max\n';
        expect(run(source + 'A 0 max')).toBe('1 8');
        expect(run(source + 'A 0 Op')).toBe('1 8');
        expect(run(source + '(A 0) max')).toBe('1');
        expect(run(source + 'A max sqrt')).toBe(String(Math.sqrt(8)));
        expect(run('2 + 3 4 min')).toBe('4');
        expect(run('A = array 1 8\nA max 5 min')).toBe('5');
    });

    it('normalizes rounding parameters instead of interpreting subtraction as a call', () => {
        expect(run('12.34 round - 1')).toBe('10');
        expect(run('12.34 round - 1 sqrt')).toBe(String(Math.sqrt(10)));
        expect(run('12.34 round - 1 * 2')).toBe('20');
        expect(run('12.34 round 1 sqrt')).toBe(String(Math.sqrt(12.3)));
        expect(run('(12.34 round 1) - 1')).toBe('11.3');
        expect(run('2 + 9 round 1')).toBe('11');
    });
});

describe('grouping diagnostics', () => {
    it('points at the second comparison, including multiline formulas', () => {
        for (const source of ['1 equal 2 equal false', '(1 equal 2\n equal false)']) {
            try { parse(source, 'comparison.ra'); throw new Error('expected rejection'); }
            catch (error) {
                expect(error).toBeInstanceOf(RankError);
                const diagnostic = error as RankError;
                expect(diagnostic.message).toContain('Add parentheses or introduce an intermediate variable');
                expect(diagnostic.location?.sourceId).toBe('comparison.ra');
                expect(diagnostic.location?.column).toBe(source.startsWith('(') ? 2 : 11);
            }
        }
    });

    it('requests a named intermediate result when functions resume after arithmetic', () => {
        for (const expression of ['2 sqrt + 1 sqrt', 'A max + 1 sum', 'A max + A + reduce']) {
            expect(() => parse('use numbers\nA = array 1 2\n' + expression))
                .toThrowError('Name the result on the left, then apply the function');
        }
        expect(() => parse('fun sigmoid X\n return X\nend\nuse linalg\nX W matmul + Bias sigmoid'))
            .toThrowError('intermediate variable');
    });
});
