import { expect, it } from 'vitest';
import { Interpreter, formatValue, isNativeFunction } from '../src/index.js';

it.each([
    ['sum', 'A Op axis 1', '6 15'],
    ['len', 'A Op axis 1', '3'],
    ['matmul', 'A A Op axis 1 1', '14 32 32 77'],
    ['transpose', 'A Op axis 1 0', '1 4 2 5 3 6'],
    ['argsort', 'A Op axis 1', '0 1 2 0 1 2'],
    ['sort', '(array 3 1 2) Op .descending', '3 2 1'],
    ['sum', 'A Op rank 1', '6 15'],
])('retains %s forms through builtin aliases', (name, expression, expected) => {
    for (const compiled of [true, false]) {
        const runtime = new Interpreter(undefined, { scalarCompilation: compiled, tensorFusion: compiled });
        runtime.execute(`use linalg\nuse sequences\nA = array shape 2 3\n 1 2 3\n 4 5 6\nend\nOp = ${name}`);
        expect(formatValue(runtime.execute(expression)!)).toBe(expected);
    }
});

it('reclassifies one cached function body for different builtin aliases', () => {
    const runtime = new Interpreter();
    runtime.execute('fun f A Op\n return A Op axis 1\nend\nA = array shape 2 2\n 1 2\n 3 4\nend');
    const fn = runtime.variables.get('f');
    if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
    expect(formatValue(fn.call([runtime.variables.get('A')!, runtime.execute('sum')!]))).toBe('3 7');
    expect(formatValue(fn.call([runtime.variables.get('A')!, runtime.execute('max')!]))).toBe('2 4');
});

it('retains builtin identity when an alias crosses a source-module boundary', () => {
    const runtime = new Interpreter(undefined, { loadModule: () => ({ id: 'worker',
        source: 'fun reduce_rows A Op\n return A Op axis 1\nend' }) });
    runtime.execute('use "worker"\nA = array shape 2 2\n 1 2\n 3 4\nend');
    const fn = runtime.variables.get('reduce_rows');
    if (!fn || !isNativeFunction(fn)) throw new Error('missing function');
    expect(formatValue(fn.call([runtime.variables.get('A')!, runtime.execute('sum')!]))).toBe('3 7');
});
