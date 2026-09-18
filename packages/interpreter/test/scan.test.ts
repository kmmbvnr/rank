import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('scan modifier', () => {
    it('returns every left-to-right prefix result', () => {
        expect(run('(array 1 2 3 4) + scan')).toBe('1 3 6 10');
        expect(run('(array 2 3 4) * scan')).toBe('2 6 24');
        expect(run('(array 10 3 2) - scan')).toBe('10 7 5');
    });

    it('accepts finite rank-one sequences and queues', () => {
        expect(run('(1 to 4) + scan')).toBe('1 3 6 10');
        expect(run('use algo\nQ = new queue\nQ push 2\nQ push 5\nQ + scan'))
            .toBe('2 7');
    });

    it('preserves an empty rank-one result', () => {
        expect(run([
            'use sequences',
            'Empty = array shape 0',
            'end',
            'Prefix = Empty + scan',
            'Prefix shape',
        ].join('\n'))).toBe('0');
    });

    it('uses with as an explicit initial value', () => {
        expect(run('(array 2 3 4) * scan with 1')).toBe('1 2 6 24');
        expect(run('(array 2 3 4) - scan with 20')).toBe('20 18 15 11');
        expect(run('Empty = array shape 0 fill 0\nEmpty + scan with 10')).toBe('10');
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
            'States = (1 to 3) next scan with Start',
            '(States 3) .num',
        ].join('\n'))).toBe('41');
        expect(run('fun add A B\n  return A + B\nend\n(array 2 3 4) add scan'))
            .toBe('2 5 9');
    });

    it('keeps sequence scans lazy, including unbounded sources', () => {
        expect(run([
            'use sequences',
            'Prefix = primes + scan with 0',
            'Prefix 4',
        ].join('\n'))).toBe('17');
    });

    it('uses named scans with optional seeds and continues the pipeline', () => {
        const setup = 'use sequences\nfun combine A B\n  return A + B\nend\n';
        expect(run(setup + '(array 2 3 4) combine scan with 0')).toBe('0 2 5 9');
        expect(run(setup + '(array 2 3 4) combine scan with (10 + 1) sum')).toBe('60');
        expect(run(setup + '(array 2 3 4) combine scan sum')).toBe('16');
        expect(run(setup + 'Empty = array shape 0 fill 0\nEmpty combine scan with 7')).toBe('7');
        expect(run(setup + 'Empty = array shape 0 fill 0\nEmpty combine scan len')).toBe('0');
        expect(run(setup + 'Prefix = primes combine scan with 0\nPrefix 4')).toBe('17');
    });

    it('accepts min and max as named scan operations', () => {
        expect(run('(array 3 1 2) min scan with 9')).toBe('9 3 1 1');
        expect(run('(array 3 1 2) max scan')).toBe('3 3 3');
    });

    it.each(['add', 'remove'])('uses a function named %s without treating scan as mutation', name => {
        const setup = `fun ${name} A B\n  return A + B\nend\nValues = array 2 3 4\n`;
        expect(run(setup + `Values ${name} scan with 0`)).toBe('0 2 5 9');
        expect(run(setup + `Values ${name} scan`)).toBe('2 5 9');
        expect(run('use algo\n' + setup + `Values ${name} segment with 0`)).toBeDefined();
    });

    it('rejects higher ranks', () => {
        expect(() => run([
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'M + scan',
        ].join('\n'))).toThrowError('+ scan expects a rank-1 value');
    });
});
