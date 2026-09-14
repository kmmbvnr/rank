import { describe, expect, it } from 'vitest';
import { Interpreter, isRankSequence } from '../src/index.js';
import { run } from './support.js';

describe('numeric range direction', () => {
    it.each([
        ['1 to 0', ''],
        ['1 until 0', ''],
        ['5 to 1 by 2', ''],
        ['5 until 1 by 2', ''],
        ['1 to 5 by -1', ''],
        ['1 until 5 by -2', ''],
        ['3 to 1 by -1', '3 2 1'],
        ['3 until 1 by -1', '3 2'],
        ['6 to 1 by -2', '6 4 2'],
        ['6 until 2 by -2', '6 4'],
        ['-5 to -1 by 2', '-5 -3 -1'],
        ['-1 to -5 by -2', '-1 -3 -5'],
        ['1 to 1 by -2', '1'],
        ['1 until 1 by -2', ''],
        ['1 to 1', '1'],
        ['1 until 1', ''],
    ])('%s produces the expected values and exact size', (source, expected) => {
        const program = `${source}`;
        expect(run(program)).toBe(expected);
        const value = new Interpreter().execute(program);
        expect(value && isRankSequence(value) && value.plan.size).toEqual({
            kind: 'exact',
            value: BigInt(expected ? expected.split(' ').length : 0),
        });
        expect(run(`use sequences\n(${source}) len`))
            .toBe(String(expected ? expected.split(' ').length : 0));
    });

    it('skips the loop for zero N and crossed variable bounds', () => {
        const output: string[] = [];
        new Interpreter(line => output.push(line)).execute([

            'N = 0',
            'for i in 1 to N',
            '  i print',
            'end',
            'L = 5',
            'R = 3',
            'for i in L until R',
            '  i print',
            'end',
        ].join('\n'));
        expect(output).toEqual([]);
    });

    it('uses the sign of a variable step', () => {
        expect(run('Start = 5\nStop = 1\nStep = -2\nStart to Stop by Step'))
            .toBe('5 3 1');
    });

    it('handles empty materialization and indexing', () => {
        expect(run('use sequences\nEmpty = (1 to 0) array\nEmpty len')).toBe('0');
        expect(() => run('(1 to 0) 0'))
            .toThrowError('sequence index out of bounds: 0');
        expect(run('(5 to 1 by -2) 2')).toBe('1');
    });

    it.each(['1 to 0', '0 until 0', '0 to 1'])('rejects zero step for %s', source => {
        expect(() => run(`${source} by 0`))
            .toThrowError('range step must be a nonzero integer');
    });

    it('keeps large range sizes exact without materializing the range', () => {
        expect(run('use sequences\n(100000000000000000000 to 0 by -3) len'))
            .toBe('33333333333333333334');
        expect(run('use sequences\n(100000000000000000000 to 0) len')).toBe('0');
    });
});
