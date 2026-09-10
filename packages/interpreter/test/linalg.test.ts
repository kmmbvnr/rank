import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('Rank linear algebra', () => {
    it('inverts a square matrix as real values', () => {
        expectNumbers(run([
            'use linalg',
            'A = array shape 2 2',
            '  4 7',
            '  2 6',
            'end',
            'A inverse',
        ].join('\n')), [0.6, -0.7, -0.2, 0.4]);
    });

    it('uses intrinsic rank 2 for batches of matrices', () => {
        expectNumbers(run([
            'use linalg',
            'T = array shape 2 2 2',
            '  4 7 2 6',
            '  1 0 0 1',
            'end',
            'T inverse',
        ].join('\n')), [0.6, -0.7, -0.2, 0.4, 1, 0, 0, 1]);
    });

    it('selects matrix cells with axis and rank', () => {
        expectNumbers(run([
            'use linalg',
            'T = array shape 2 2 2',
            '  4 7 1 0',
            '  2 6 0 1',
            'end',
            'T inverse axis 1 rank 2',
        ].join('\n')), [0.6, -0.7, -0.2, 0.4, 1, 0, 0, 1]);
    });

    it('preserves the cell shape for an empty batch', () => {
        expect(run([
            'use linalg',
            'use sequences',
            'Batch = array shape 0 3 3 pad 0',
            'Result = Batch inverse',
            'Result shape',
        ].join('\n'))).toBe('0 3 3');
    });

    it('rejects nonsquare and singular matrices', () => {
        expect(() => run('use linalg\n(array shape 2 3 pad 1) inverse'))
            .toThrowError('inverse expects a square rank-2 matrix');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2',
            '  1 2',
            '  2 4',
            'end',
            'A inverse',
        ].join('\n'))).toThrowError('inverse expects a nonsingular matrix');
    });
});

function expectNumbers(actual: string | undefined, expected: readonly number[]): void {
    expect(actual).toBeDefined();
    const values = actual!.split(' ').map(Number);
    expect(values).toHaveLength(expected.length);
    values.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 12));
}
