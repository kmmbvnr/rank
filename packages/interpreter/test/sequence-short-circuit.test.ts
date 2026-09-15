import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    return formatValue(new Interpreter().execute(source)!);
}

describe('short-circuiting sequence selectors', () => {
    it('returns the first selected value and its index', () => {
        expect(run('Values = array 3 8 13 21\nMask = Values greater 10\nValues first where Mask')).toBe('13');
        expect(run('Values = array 3 8 13 21\nMask = Values greater 10\nValues first index where Mask')).toBe('2');
    });

    it('composes a missing match with default', () => {
        expect(run('Values = array 1 2 3\nMask = Values greater 9\n(Values first where Mask) default -1')).toBe('-1');
    });

    it('stops an unbounded sequence at its first match', () => {
        expect(run([
            'use sequences',
            'Candidates = primes',
            'Mask = Candidates greater 100',
            'Candidates first where Mask',
        ].join('\n'))).toBe('101');
    });

    it('takes a material prefix while its mask remains true', () => {
        expect(run('use numbers\nValues = array 2 4 7 8\nMask = Values even\nValues take while Mask')).toBe('2 4');
    });

    it('keeps take while lazy over an unbounded source', () => {
        expect(run([
            'use sequences',
            'Values = primes',
            'Mask = Values less 10',
            'Small = Values take while Mask',
            'Small array',
        ].join('\n'))).toBe('2 3 5 7');
    });

    it('validates mask values and known lengths', () => {
        expect(() => run('Values = array 1 2\nValues first where (array true)'))
            .toThrowError('first where mask length 1 does not match source length 2');
        expect(() => run('Values = array 1 2\nValues take while (array 1 0)'))
            .toThrowError('take while expects a boolean mask');
    });
});
