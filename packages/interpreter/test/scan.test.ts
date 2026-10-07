import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('scan modifier', () => {
    it('returns every left-to-right prefix result', () => {
        expect(run('(array 1 2 3 4) scan +')).toBe('1 3 6 10');
        expect(run('(array 2 3 4) scan *')).toBe('2 6 24');
        expect(run('(array 10 3 2) scan -')).toBe('10 7 5');
    });

    it('accepts finite rank-one sequences and queues', () => {
        expect(run('(1 to 4) scan +')).toBe('1 3 6 10');
        expect(run('use algo\nQ = new queue\nQ push 2\nQ push 5\nQ scan +'))
            .toBe('2 7');
    });

    it('preserves an empty rank-one result', () => {
        expect(run([
            'use sequences',
            'Empty = array shape 0',
            'end',
            'Prefix = Empty scan +',
            'Prefix shape',
        ].join('\n'))).toBe('0');
    });

    it('uses with as an explicit initial value', () => {
        expect(run('(array 2 3 4) scan * with 1')).toBe('1 2 6 24');
        expect(run('(array 2 3 4) scan - with 20')).toBe('20 18 15 11');
        expect(run('Empty = array shape 0 fill 0\nEmpty scan + with 10')).toBe('10');
    });

    it('scans with a user-defined binary function and a seed', () => {
        expect(run([
            'fun next State Ignored',
            '  return record',
            '    .num = State .num + 2 * State .den',
            '    .den = State .num + State .den',
            '  end',
            'end',
            'Start = record',
            '  .num = 3',
            '  .den = 2',
            'end',
            'States = (1 to 3) scan next with Start',
            '(States 3) .num',
        ].join('\n'))).toBe('41');
        expect(run('fun add A B\n  return A + B\nend\n(array 2 3 4) scan add'))
            .toBe('2 5 9');
    });

    it('keeps sequence scans lazy, including unbounded sources', () => {
        expect(run([
            'use sequences',
            'Prefix = primes scan + with 0',
            'Prefix 4',
        ].join('\n'))).toBe('17');
    });

    it('uses named scans with optional seeds and continues the pipeline', () => {
        const setup = 'use sequences\nfun combine A B\n  return A + B\nend\n';
        expect(run(setup + '(array 2 3 4) scan combine with 0')).toBe('0 2 5 9');
        expect(run(setup + '(array 2 3 4) scan combine with (10 + 1) sum')).toBe('60');
        expect(run(setup + '(array 2 3 4) scan combine sum')).toBe('16');
        expect(run(setup + 'Empty = array shape 0 fill 0\nEmpty scan combine with 7')).toBe('7');
        expect(run(setup + 'Empty = array shape 0 fill 0\nEmpty scan combine len')).toBe('0');
        expect(run(setup + 'Prefix = primes scan combine with 0\nPrefix 4')).toBe('17');
    });

    it('accepts min and max as named scan operations', () => {
        expect(run('(array 3 1 2) scan min with 9')).toBe('9 3 1 1');
        expect(run('(array 3 1 2) scan max')).toBe('3 3 3');
    });

    it.each(['combineadd', 'combineremove'])('uses a function named %s without treating scan as mutation', name => {
        const setup = `fun ${name} A B\n  return A + B\nend\nValues = array 2 3 4\n`;
        expect(run(setup + `Values scan ${name} with 0`)).toBe('0 2 5 9');
        expect(run(setup + `Values scan ${name}`)).toBe('2 5 9');
        expect(run('use algo\n' + setup + `Values segment ${name} with 0`)).toBeDefined();
    });

    it('rejects higher ranks', () => {
        expect(() => run([
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'M scan +',
        ].join('\n'))).toThrowError('scan + expects a rank-1 value');
    });
});

describe('scan along an axis', () => {
    const table = 'use sequences\nT = (1 to 12) reshape 3 4\n';

    it('accumulates down the rows and along the columns, keeping the shape', () => {
        expect(run(`${table}T scan + axis 0`)).toBe('1 2 3 4 6 8 10 12 15 18 21 24');
        expect(run(`${table}T scan + axis 1`)).toBe('1 3 6 10 5 11 18 26 9 19 30 42');
        expect(run(`${table}(T scan + axis 0) shape`)).toBe('3 4');
    });

    it('scans the middle axis of a tensor', () => {
        expect(run('use sequences\nT = (1 to 8) reshape 2 2 2\nT scan * axis 1')).toBe('1 2 3 8 5 6 35 48');
    });

    it('gives the rank-one scan for a vector', () => {
        expect(run('(array 1 2 3 4) scan + axis 0')).toBe('1 3 6 10');
    });

    it('subtracts from the first item, as the rank-one scan does', () => {
        expect(run(`${table}T scan - axis 0`)).toBe('1 2 3 4 -4 -4 -4 -4 -13 -14 -15 -16');
    });

    it('scans named operations such as max, min and user functions', () => {
        const values = 'use sequences\nT = (array 3 1 4 1 5 9 2 6 5 3 5 8) reshape 3 4\n';
        expect(run(`${values}T scan max axis 0`)).toBe('3 1 4 1 5 9 4 6 5 9 5 8');
        expect(run(`${values}T scan min axis 1`)).toBe('3 1 1 1 5 5 2 2 5 3 3 3');
        expect(run(`${values}fun tens Left Right\n  return Left * 10 + Right\nend\nT scan tens axis 1`))
            .toBe('3 31 314 3141 5 59 592 5926 5 53 535 5358');
    });

    it('agrees with the rank-one scan on every column of a large real table', () => {
        const source = [
            'use sequences', 'use numbers',
            'T = ((0 till 6000) real rank 0) * 0.5 reshape 300 20',
            'S = T scan + axis 0',
            'Column = T # 7',
            'Expected = Column scan +',
            'Got = S # 7',
            '(Got - Expected) abs max',
        ].join('\n');
        expect(run(source)).toBe('0');
    });

    it('scans a large lazy source', () => {
        expect(run('use sequences\nT = (1 to 6000) reshape 300 20\nU = T * 2\nS = U scan + axis 0\nS 299 0')).toBe('1794600');
    });

    it('rejects an axis the array does not have and non-arrays', () => {
        expect(() => run(`${table}T scan + axis 2`)).toThrow(/no axis 2/);
        expect(() => run('5 scan + axis 0')).toThrow(/expects an array/);
    });

    it('needs a literal axis', () => {
        expect(() => run(`${table}Axis = 0\nT scan + axis Axis`)).toThrow();
    });
});
