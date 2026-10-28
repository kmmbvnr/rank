import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string, args: string[] = []) {
    return new Interpreter(() => {}, { args }).execute(`use cli\n${source}`);
}

describe('unified program arguments', () => {
    const scalars = 'arg Input path\narg Limit integer = 1000\nInput + ":" + (Limit text)';
    it.each([
        [['data.csv', '100'], 'data.csv:100'],
        [['--input', 'data.csv', '--limit', '100'], 'data.csv:100'],
        [['--limit', '100', 'data.csv'], 'data.csv:100'],
        [['data.csv', '--limit=100'], 'data.csv:100'],
        [['data.csv'], 'data.csv:1000'],
    ])('binds named inputs before remaining positions: %j', (args, expected) => {
        expect(run(scalars, args as string[])).toBe(expected);
    });
    const array = 'arg Numbers integer array = array 1 2 3\nNumbers';
    it.each([
        [[], '1 2 3'],
        [['4', '5', '6'], '4 5 6'],
        [['--numbers=4', '--numbers=5', '--numbers=6'], '4 5 6'],
    ])('binds array inputs and defaults: %j', (args, expected) => {
        expect(formatValue(run(array, args as string[])!)).toBe(expected);
    });
    it('combines scalar positions with an array tail', () => {
        expect(run('arg N integer\narg Values integer array\nN + (Values sum)', ['10', '1', '2', '3'])).toBe(16n);
    });
    it('keeps workspace values ahead of CLI and defaults', () => {
        const runtime = new Interpreter(() => {}, { args: ['--limit=9', 'file'] });
        runtime.variables.set('Limit', 7n);
        expect(runtime.execute(`use cli\n${scalars}`)).toBe('file:7');
    });
    it('validates required inputs, types and surplus positions', () => {
        expect(() => run('arg N integer')).toThrow('missing argument: --n');
        expect(() => run('arg N integer', ['oops'])).toThrow('expected integer input');
        expect(() => run('arg N integer', ['1', '2'])).toThrow('unexpected argument: 2');
        expect(() => run('arg Ns integer array\narg N integer', ['1'])).toThrow('array argument must be last');
        expect(() => run('arg Ns integer array = 1')).toThrow('expects multiple integer values');
    });
    it.each(['option N integer = 1', 'argument N integer = 1', 'arg N integer many', 'arg N integer .many'])('rejects removed declaration syntax: %s', source => {
        expect(() => run(source)).toThrow();
    });
});
