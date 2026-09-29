import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

function run(source: string): string {
    return formatValue(new Interpreter().execute(source)!);
}

describe('short-circuiting sequence selectors', () => {
    it('returns the first selected value and its index', () => {
        expect(run('Values = array 3 8 13 21\nMask = Values greater 10\nValues first where Mask')).toBe('13');
        expect(run('Values = array 3 8 13 21\nMask = Values greater 10\nValues first index where Mask')).toBe('2');
        expect(run('Values = array 3 8 13 21\nValues first where greater 10')).toBe('13');
        expect(run('Values = array 3 8 13 21\nValues first index where greater 10')).toBe('2');
    });

    it('composes a missing match with default', () => {
        expect(run('Values = array 1 2 3\nMask = Values greater 9\n(Values first where Mask) default -1')).toBe('-1');
        expect(run('Values = array 1 2 3\n(Values first where greater 9) default -1')).toBe('-1');
    });

    it('stops an unbounded sequence at its first match', () => {
        expect(run([
            'use sequences',
            'Candidates = primes',
            'Mask = Candidates greater 100',
            'Candidates first where Mask',
        ].join('\n'))).toBe('101');
        expect(run('use sequences\nprimes first where greater 100')).toBe('101');
    });

    it('keeps the items before the first that meets a till condition', () => {
        expect(run('use numbers\nValues = array 2 4 7 8\nValues till not even')).toBe('2 4');
        expect(run('use numbers\nValues = array 2 4 7 8\nMask = Values even\nValues till (not Mask)')).toBe('2 4');
        expect(run('Values = array 2 4 7 8\nValues till 4')).toBe('2 4');
        expect(run('Values = array 2 4 7 8\nValues till at least 4')).toBe('2');
        expect(run('"hello world" till equal " "')).toBe('hello');
    });

    it('starts from the first item that meets a from condition', () => {
        expect(run('Values = array 2 4 7 8\nValues from 5')).toBe('7 8');
        expect(run('Values = array 2 4 7 8\nValues from greater 4')).toBe('7 8');
        expect(run('use numbers\nValues = array 2 4 7 3\nValues from not even')).toBe('7 3');
        expect(run('Values = array 2 4\nValues from 9')).toBe('');
    });

    it('keeps till and from lazy over an unbounded source', () => {
        expect(run('use sequences\nprimes till 10 array')).toBe('2 3 5 7');
        expect(run('use sequences\nprimes till at least 7 array')).toBe('2 3 5');
        expect(run('use sequences\nprimes from greater 7 take 2 array')).toBe('11 13');
        expect(run([
            'use sequences',
            'fun big X',
            '  return X greater 10',
            'end',
            'fibonacci till big array',
        ].join('\n'))).toBe('1 2 3 5 8');
        expect(run('use sequences\nuse numbers\nfibonacci filter even till 1000 array')).toBe('2 8 34 144 610');
        expect(run('use sequences\nuse numbers\nfibonacci till 1000 filter even array')).toBe('2 8 34 144 610');
    });

    it('validates mask values and known lengths', () => {
        expect(() => run('Values = array 1 2\nValues first where (array true)'))
            .toThrowError('first where mask length 1 does not match source length 2');
        expect(() => run('Values = array 1 2\nValues till (array 1 0)'))
            .toThrowError('till expects a boolean mask');
    });
});
