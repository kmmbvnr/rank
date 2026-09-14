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

    it('rejects higher ranks and unbounded sequences', () => {
        expect(() => run([
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'M + scan',
        ].join('\n'))).toThrowError('+ scan expects a rank-1 value');
        expect(() => run('use sequences\nfibonacci + scan'))
            .toThrowError('+ scan requires a bounded sequence');
    });
});
