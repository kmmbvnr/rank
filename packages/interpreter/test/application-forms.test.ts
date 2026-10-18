import { expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction } from '../src/index.js';

it.each([
    ['sum', 'A op axis 1', '6 15'],
    ['len', 'A op axis 1', '3'],
    ['matmul', 'A A op axis 1 1', '14 32 32 77'],
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
    ['array Lim Lim', 'mask shape mismatch: 2 and 1'],
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
