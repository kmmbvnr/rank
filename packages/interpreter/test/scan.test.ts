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

    it('keeps sequence scans lazy, including unbounded sources', () => {
        expect(run([
            'use sequences',
            'Prefix = primes + scan with 0',
            'Prefix 4',
        ].join('\n'))).toBe('17');
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
