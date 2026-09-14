import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { formattedText } from '../src/modules/text.js';
import { run } from './support.js';

describe('text formatting and join', () => {
    it('formats numbers with a literal modifier and chains print', () => {
        const output: string[] = [];
        new Interpreter(value => output.push(value)).execute(`
use text
use io
(2 / 3) text ".6f" print
12 text ".3f" print
2.5 text ".0f" print
3.5 text ".0f" print
(-0.0001) text ".3f" print
`);
        expect(output).toEqual(['0.666667', '12.000', '2', '4', '0.000']);
    });

    it('keeps ordinary text unary and supports preceding calls', () => {
        expect(run('use text\n12 text')).toBe('12');
        expect(run('use text\nuse numbers\n(-2.5) abs text ".2f"')).toBe('2.50');
        expect(run('use text\nF = text\n12 F')).toBe('12');
    });

    it('expands exponents and preserves exact large integers', () => {
        expect(formattedText(1e21, '.2f')).toBe('1000000000000000000000.00');
        expect(formattedText(1e-7, '.8f')).toBe('0.00000010');
        expect(formattedText(-1e22, '.0f')).toBe('-10000000000000000000000');
        expect(formattedText(900719925474099312345n, '.2f')).toBe('900719925474099312345.00');
        expect(formattedText(Infinity, '.2f')).toBe('infinity');
        expect(formattedText(-0, '.2f')).toBe('0.00');
    });

    it('formats arrays without losing shape and joins formatted rows', () => {
        expect(run('use text\n(array 1 2 3) text ".2f" "," join')).toBe('1.00,2.00,3.00');
        const value = { kind: 'array' as const, shape: [2, 2], items: [1n, 2n, 3n, 4n] };
        expect(formattedText(value, '.1f')).toEqual({ ...value, items: ['1.0', '2.0', '3.0', '4.0'] });
        const output: string[] = [];
        new Interpreter(line => output.push(line)).execute(`
use text
use io
Matrix = array shape 2 3 pad 1.25
for Row in Matrix
  Row text ".1f" " " join print
end
`);
        expect(output).toEqual(['1.2 1.2 1.2', '1.2 1.2 1.2']);
    });

    it('joins scalar arrays, ranges and empty sequences', () => {
        expect(run('use text\n(array "ab" "cd") "" join')).toBe('abcd');
        expect(run('use text\n(array 1 true "x") ", " join')).toBe('1, true, x');
        expect(run('use text\n(1 to 3) ":" join')).toBe('1:2:3');
        expect(run('use text\n(1 to 0) "," join')).toBe('');
        expect(run('use text\n(1 to 3) text ".1f" "," join')).toBe('1.0,2.0,3.0');
    });

    it('rejects invalid formats, precision and element types with Rank errors', () => {
        for (const format of ['f', '.-1f', '.101f', '.2e', '.2f extra']) {
            expect(() => run(`use text\n1 text "${format}"`)).toThrow(/text (format|precision)/);
        }
        expect(() => run('use text\n"hello" text ".2f"')).toThrow('numeric input');
        expect(() => run('use text\n(array 1 2) 0 join')).toThrow('separator must be text');
        expect(() => run('use text\n1 "," join')).toThrow('rank-1 collection');
        expect(() => run('use text\n(array shape 2 2 pad 0) "," join')).toThrow('join matrix rows separately');
        expect(run('1 text ".2f"')).toBe('1.00');
    });
});
