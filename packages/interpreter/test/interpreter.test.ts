import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function run(source: string): string | undefined {
    const result = new Interpreter().execute(source);
    return result === undefined ? undefined : formatValue(result);
}

describe('Rank interpreter', () => {
    it('evaluates expressions with precedence', () => {
        expect(run('2 + 3 * 4')).toBe('14');
        expect(run('(2 + 3) * 4')).toBe('20');
        expect(run('-7 / 3')).toBe('-2');
        expect(run('1 not equal 2')).toBe('true');
        expect(run('not false')).toBe('true');
        expect(run('true xor false')).toBe('true');
    });

    it('keeps variables between executions', () => {
        const interpreter = new Interpreter();
        interpreter.execute('Answer = 6 * 7');
        expect(formatValue(interpreter.execute('Answer')!)).toBe('42');
    });

    it('loads vocabulary without changing the grammar', () => {
        expect(() => run('1 to 3')).toThrowError('to requires: use ranges');
        expect(() => run('3 multiple by 2')).toThrowError('multiple by requires: use numbers');
        expect(run('use ranges\n1 to 3')).toBe('1 2 3');
        expect(run('use ranges\nuse numbers\n(1 to 5) sum')).toBe('15');
    });

    it('broadcasts scalar operations over sequences', () => {
        expect(run('use ranges\n(1 to 3) * 10')).toBe('10 20 30');
        expect(run('use ranges\n1 to 4 greater 2')).toBe('false false true true');
    });

    it('updates values with compound assignment', () => {
        expect(run('Value = 10\nValue += 5\nValue *= 2\nValue -= 4\nValue /= 2\nValue %= 4\nValue')).toBe('1');
        expect(run('Mask = true\nMask and= true\nMask xor= true\nMask or= true\nMask')).toBe('true');
    });

    it('runs Euler 1 with word operations and a mask', () => {
        const source = [
            'use ranges',
            'use numbers',
            'N = 1 until 1000',
            'Mask = N multiple by 3',
            'Mask or= N multiple by 5',
            'N Mask sum',
        ].join('\n');
        expect(run(source)).toBe('233168');
    });

    it('rejects names from modules that were not imported', () => {
        expect(() => run('sum 1')).toThrowError(RankError);
        expect(() => run('sum 1')).toThrowError('unknown name: sum');
    });

    it('sends print output through an injected function', () => {
        const lines: string[] = [];
        const interpreter = new Interpreter(line => lines.push(line));
        expect(formatValue(interpreter.execute('use io\nprint 42')!)).toBe('42');
        expect(lines).toEqual(['42']);
    });

    it('resolves program inputs as workspace, args, then default', () => {
        const source = 'use cli\noption Limit integer = 1000\nLimit';
        expect(new Interpreter(undefined, { args: ['--limit', '20'] }).execute(source)).toBe(20n);

        const interpreter = new Interpreter(undefined, { args: ['--limit', '20'] });
        interpreter.variables.set('Limit', 10n);
        expect(interpreter.execute(source)).toBe(10n);
        expect(run(source)).toBe('1000');
    });

    it('loads an open program and runs it in the current workspace', () => {
        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/example_test.ra',
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        expect(interpreter.execute('use "worker"\nLimit = 10\nrun\nAnswer')).toBe(11n);
    });

    it('runs a program through an explicit module alias', () => {
        const interpreter = new Interpreter(undefined, {
            loadModule: specifier => ({
                id: specifier,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        expect(interpreter.execute('use "worker" as W\nW.Limit = 20\nW.run\nW.Answer')).toBe(21n);
    });

    it('executes isolated Rank test blocks', () => {
        const interpreter = new Interpreter(undefined, {
            sourceId: '/tests/worker_test.ra',
            testing: true,
            loadModule: specifier => ({
                id: `/tests/${specifier}.ra`,
                source: 'use cli\noption Limit integer = 1000\nAnswer = Limit + 1',
            }),
        });
        interpreter.execute([
            'use testing',
            'test "workspace input"',
            '  use "worker"',
            '  Limit = 10',
            '  run',
            '  Answer equal 11',
            'end',
            'test "false result"',
            '  1 equal 2',
            'end',
        ].join('\n'));
        expect(interpreter.testResults).toEqual([
            { name: 'workspace input', passed: true, output: [] },
            {
                name: 'false result',
                passed: false,
                output: [],
                error: 'boolean test expression evaluated to false',
            },
        ]);
    });
});
