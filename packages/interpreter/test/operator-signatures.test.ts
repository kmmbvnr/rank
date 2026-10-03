import { expect, it } from 'vitest';
import { operatorSignature } from '@arrrank/language';
import { Interpreter } from '../src/index.js';
import { typeName } from '../src/value.js';

it('checks non-compiler arithmetic and missing contracts against runtime results', () => {
    for (const [source, operator, left, right, expected] of [
        ['3.5 // 2', '//', 'real', 'integer', 'real'],
        ['3.5 % 2', '%', 'real', 'integer', 'real'],
        ['2 ** -1', '**', 'integer', 'integer', 'real'],
        ['2 ** 3', '**', 'integer', 'integer', 'integer'],
        ['"a" + "b"', '+', 'text', 'text', 'text'],
        ['.NA less 3', 'less', 'missing', 'integer', 'missing'],
        ['"1" equal 1', 'equal', 'text', 'integer', 'boolean'],
        ['.NA equal 1', 'equal', 'missing', 'integer', 'missing'],
        ['.NA and false', 'and', 'missing', 'boolean', 'boolean'],
        ['.NA and true', 'and', 'missing', 'boolean', 'missing'],
        ['.NA or true', 'or', 'missing', 'boolean', 'boolean'],
        ['.NA xor false', 'xor', 'missing', 'boolean', 'missing'],
        ['use dates\n("2026-10-03" date datetime) + (1 duration)', '+', 'datetime', 'duration', 'datetime'],
        ['use dates\n("2026-10-04" date datetime) - ("2026-10-03" date datetime)', '-', 'datetime', 'datetime', 'duration'],
        ['use dates\n(2 duration) * 1.5', '*', 'duration', 'real', 'duration'],
    ]) {
        expect(typeName(new Interpreter().execute(source)!), source).toBe(expected);
        const signature = operatorSignature(operator, [{ types: [left] }, { types: [right] }])!;
        const results = signature.split(' ; ').map(part => part.split(' → ')[1].split(' [rank')[0]);
        expect(results.some(result => result.split(' | ').includes(expected)
            || result === 'number' && ['integer', 'real'].includes(expected)), source).toBe(true);
    }
});

it('keeps shape and guard restrictions separate from cell types', () => {
    expect(typeName(new Interpreter().execute('(array true false) and true')!)).toBe('array');
    expect(() => new Interpreter().execute('true and (array true false)')).toThrow('single boolean');
    expect(() => new Interpreter().execute('(1 to 3) equal (1 to 3)')).toThrow('two sequences');
});


it('checks range and bound collection kinds without confusing bounds with lifted cells', () => {
    for (const [source, expected] of [
        ['1 to 3', 'sequence'], ['1 till 3', 'sequence'],
        ['(1 to 5) till 3', 'sequence'], ['(array 1 2 3) till 3', 'array'],
        ['"abc" till "c"', 'text'],
        ['use algo\nQ = new queue\nQ push 1\nQ push 2\nQ till 2', 'array'],
        ['(1 to 3) (1 to 4) outer +', 'array'],
    ]) expect(typeName(new Interpreter().execute(source)!), source).toBe(expected);
    expect(() => new Interpreter().execute('(array shape 2 2 fill 1) till 3')).toThrow('rank-1');
});
