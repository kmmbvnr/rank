import { expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction } from '../src/index.js';

it.each([
    ['sum', 'A op axis 1', '6 15'],
    ['len', 'A op axis 1', '3'],
    ['matmul', 'A op A axis 1 1', '14 32 32 77'],
    ['transpose', 'A op axis 1 0', '1 4 2 5 3 6'],
    ['argsort', 'A op axis 1', '0 1 2 0 1 2'],
    ['sort', '(array 3 1 2) op .descending', '3 2 1'],
    ['sum', 'A op rank 1', '6 15'],
])('retains %s forms through builtin aliases', (name, expression, expected) => {
    for (const compiled of [true, false]) {
        const runtime = new Interpreter(undefined, { scalarCompilation: compiled, tensorFusion: compiled });
        runtime.execute(`use linalg\nuse sequences\nA = array shape 2 3\n 1 2 3\n 4 5 6\nend\nop = ${name}`);
        expect(formatValue(runtime.execute(expression)!)).toBe(expected);
    }
});

it('reclassifies one cached function body for different builtin aliases', () => {
    const runtime = new Interpreter();
    runtime.execute('fun A f op\n return A op axis 1\nend\nA = array shape 2 2\n 1 2\n 3 4\nend');
    const fn = runtime.variables.get('f');
    if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
    expect(formatValue(fn.call([runtime.variables.get('A')!, runtime.execute('sum')!]))).toBe('3 7');
    expect(formatValue(fn.call([runtime.variables.get('A')!, runtime.execute('max')!]))).toBe('2 4');
});

it('retains builtin identity when an alias crosses a source-module boundary', () => {
    const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'worker',
        source: 'fun A reduce_rows op\n return A op axis 1\nend' }) });
    runtime.execute('use "worker"\nA = array shape 2 2\n 1 2\n 3 4\nend');
    const fn = runtime.variables.get('reduce_rows');
    if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
    expect(formatValue(fn.call([runtime.variables.get('A')!, runtime.execute('sum')!]))).toBe('3 7');
});

it.each([
    ['1 to Lim', '6'],
    ['array Lim Lim', '2'],
])('evaluates a pipeline after a user function returning %s as after its group', (body, expected) => {
    for (const compiled of [true, false]) {
        const run = (pipeline: string) => {
            const runtime = new Interpreter(undefined, { scalarCompilation: compiled, tensorFusion: compiled });
            runtime.execute(`use sequences\nfun Lim upto\n return ${body}\nend`);
            try {
                return formatValue(runtime.execute(pipeline)!);
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        };
        expect(run('6 upto array len')).toBe(expected);
        expect(run('(6 upto) array len')).toBe(expected);
    }
});

it.each([false, true])('evaluates ungrouped user sources without internal names (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    try {
        runtime.execute(`use sequences
use linalg
fun N upto
 return 1 to N array
end

fun N sq
 return array 1 2 3 4 5 6 7 8 9 shape N N
end

win = window
diagonal = diag
source = upto`);
        for (const [index, [source, operation, expected]] of [
            ['6 upto', 'window 3', '1 2 3 2 3 4 3 4 5 4 5 6'],
            ['6 upto', 'window 3 stride 2', '1 2 3 3 4 5'],
            ['6 upto', 'win 3', '1 2 3 2 3 4 3 4 5 4 5 6'],
            ['6 source', 'window 3', '1 2 3 2 3 4 3 4 5 4 5 6'],
            ['3 sq', 'diagonal .anti', '3 5 7'],
            ['3 sq', 'diag .anti', '3 5 7'],
            ['3 sq', 'diag 0', '1 5 9'],
            ['3 sq', 'diag .anti 0 rank 2', '3 5 7'],
        ].entries()) {
            expect(formatValue(runtime.execute(`${source} ${operation}`)!)).toBe(expected);
            expect(formatValue(runtime.execute(`(${source}) ${operation}`)!)).toBe(expected);
            runtime.execute(`Result${index} = ${source} ${operation}`);
            expect(formatValue(runtime.variables.get(`Result${index}`)!)).toBe(expected);
        }
    } finally { runtime.dispose(); }
});


it.each([false, true])('evaluates a window source once (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation });
    try {
        runtime.execute(`use sequences
fun N source State
 State .calls += 1
 return 1 to N array
end

State = record
 .calls = 0
end
Result = 6 source State window 3`);
        expect(formatValue(runtime.variables.get('Result')!)).toBe('1 2 3 2 3 4 3 4 5 4 5 6');
        expect(runtime.execute('State .calls')).toBe(1n);
    } finally { runtime.dispose(); }
});

it.each([false, true])('rejects standalone axis addressing (compilation=%s)', compilation => {
    const runtime = new Interpreter(undefined, { compilation, tensorFusion: compilation });
    try {
        runtime.execute('use sequences\nA = (1 to 6) reshape 2 3\nJ = 1\nRows = array 1 0');
        for (const expression of [
            'A axis 1 J', 'A axis -1 0', 'A axis 0 Rows',
            'A axis 1 (array 0 2) sum', 'A axis 1 J less 3',
        ]) {
            expect(() => runtime.execute(expression)).toThrow('unknown name: axis');
        }
        expect(formatValue(runtime.execute('A # J')!)).toBe('2 5');
        expect(formatValue(runtime.execute('A Rows #')!)).toBe('4 5 6 1 2 3');
    } finally { runtime.dispose(); }
});
