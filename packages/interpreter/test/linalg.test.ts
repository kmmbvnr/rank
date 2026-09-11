import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('Rank linear algebra', () => {
    it('constructs and extracts diagonals', () => {
        expect(run([
            'use linalg',
            'use sequences',
            'D = (array 1 2 3) diag',
            'ShapeOk = (D shape equal array 3 3) and reduce',
            'ValuesOk = D equal array shape 3 3',
            '  1 0 0',
            '  0 2 0',
            '  0 0 3',
            'end',
            'ShapeOk and (ValuesOk and reduce)',
        ].join('\n'))).toBe('true');
        expect(run([
            'use linalg',
            'A = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'A diag',
        ].join('\n'))).toBe('1 5');
        expect(run([
            'use linalg',
            'D = (array 1.5 2.5) diag',
            'D 0 1 is .real',
        ].join('\n'))).toBe('true');
        expect(run('use linalg\nuse sequences\n(array shape 0 pad 0) diag shape'))
            .toBe('0 0');
    });

    it('validates diagonal inputs', () => {
        expect(() => run('use linalg\n1 diag'))
            .toThrowError('diag expects a rank-1 vector or rank-2 matrix');
        expect(() => run('use linalg\n(array shape 1 1 1 pad 0) diag'))
            .toThrowError('diag expects a rank-1 vector or rank-2 matrix');
        expect(() => run('use linalg\n(array 1 "bad") diag'))
            .toThrowError('diag expects numeric elements');
    });

    it('decomposes real symmetric matrices with eigh', () => {
        expect(run([
            'use linalg',
            'use numbers',
            'A = array shape 3 3',
            '  3 0 0',
            '  0 1 0',
            '  0 0 2',
            'end',
            'unpack Values Vectors = A eigh',
            'array Values Vectors',
        ].join('\n'))).toBe('1 2 3 0 0 1 1 0 0 0 1 0');

        expectNumbers(run([
            'use linalg',
            'A = array shape 2 2',
            '  2 1',
            '  1 2',
            'end',
            'unpack Values Vectors = A eigh',
            'array Values Vectors',
        ].join('\n')), [
            1, 3,
            Math.SQRT1_2, Math.SQRT1_2,
            -Math.SQRT1_2, Math.SQRT1_2,
        ]);
    });

    it('returns orthonormal eigh eigenvectors', () => {
        expect(run([
            'use linalg',
            'use numbers',
            'use sequences',
            'A = array shape 3 3',
            '  4 1 1',
            '  1 3 0',
            '  1 0 2',
            'end',
            'unpack Values Vectors = A eigh',
            'Gram = Vectors transpose Vectors matmul',
            'Gram round 10',
        ].join('\n'))).toBe('1 0 0 0 1 0 0 0 1');
    });

    it('validates eigh matrices and elements', () => {
        expect(() => run('use linalg\n(array 1 2) eigh'))
            .toThrowError('eigh expects a square rank-2 matrix');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2',
            '  1 2',
            '  0 1',
            'end',
            'A eigh',
        ].join('\n'))).toThrowError('eigh expects a symmetric matrix');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2',
            '  1 "bad"',
            '  "bad" 1',
            'end',
            'A eigh',
        ].join('\n'))).toThrowError('eigh expects numeric elements');
        expect(() => run('(array shape 1 1 pad 1) eigh'))
            .toThrowError('unknown name: eigh');
    });

    it('computes exact integer and real determinants', () => {
        expect(run([
            'use linalg',
            'A = array shape 3 3',
            '  6 1 1',
            '  4 -2 5',
            '  2 8 7',
            'end',
            'A det',
        ].join('\n'))).toBe('-306');
        expect(run([
            'use linalg',
            'A = array shape 2 2',
            '  0 1',
            '  1 0',
            'end',
            'D = A det',
            'D equal -1 and D is .integer',
        ].join('\n'))).toBe('true');
        expect(run([
            'use linalg',
            'A = array shape 2 2',
            '  1 2',
            '  2 4',
            'end',
            'A det',
        ].join('\n'))).toBe('0');
        expect(run([
            'use linalg',
            'A = array shape 2 2',
            '  1.5 2',
            '  3 4',
            'end',
            'A det is .real',
        ].join('\n'))).toBe('true');
        expect(run('use linalg\n(array shape 0 0 pad 0) det')).toBe('1');
    });

    it('applies determinant to matrix cells by rank and axis', () => {
        const tensor = [
            'use linalg',
            'T = array shape 2 2 2',
            '  4 7 1 0',
            '  2 6 0 1',
            'end',
        ];
        expect(run([...tensor, 'T det'].join('\n'))).toBe('-7 2');
        expect(run([...tensor, 'T det axis 1 rank 2'].join('\n'))).toBe('10 1');
    });

    it('validates determinant matrices and elements', () => {
        expect(() => run('use linalg\n(array 1 2) det'))
            .toThrowError('det expects a square rank-2 matrix');
        expect(() => run('use linalg\n(array shape 2 3 pad 1) det'))
            .toThrowError('det expects a square rank-2 matrix');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2',
            '  1 "bad"',
            '  3 4',
            'end',
            'A det',
        ].join('\n'))).toThrowError('det expects numeric elements');
        expect(() => run('(array shape 2 2 pad 1) det'))
            .toThrowError('unknown name: det');
    });

    it('solves systems with vector and matrix right sides', () => {
        expectNumbers(run([
            'use linalg',
            'A = array shape 2 2',
            '  3 1',
            '  1 2',
            'end',
            'A (array 9 8) solve',
        ].join('\n')), [2, 3]);
        expectNumbers(run([
            'use linalg',
            'A = array shape 2 2',
            '  3 1',
            '  1 2',
            'end',
            'B = array shape 2 2',
            '  9 1',
            '  8 0',
            'end',
            'A B solve',
        ].join('\n')), [2, 0.4, 3, -0.2]);
        expect(run([
            'use linalg',
            'A = array shape 2 2',
            '  1 0',
            '  0 1',
            'end',
            'B = array 1 2',
            'X = A B solve',
            'X 0 is .real and X 1 is .real',
        ].join('\n'))).toBe('true');
    });

    it('validates linear solve shapes, singularity and elements', () => {
        expect(() => run('use linalg\n(array 1 2) (array 1 2) solve'))
            .toThrowError('solve expects a square rank-2 coefficient matrix');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2 pad 1',
            'B = array 1 2 3',
            'A B solve',
        ].join('\n'))).toThrowError('solve dimensions differ: 2 and 3');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2',
            '  1 2',
            '  2 4',
            'end',
            'A (array 1 2) solve',
        ].join('\n'))).toThrowError('solve expects a nonsingular matrix');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2',
            '  1 "bad"',
            '  0 1',
            'end',
            'A (array 1 2) solve',
        ].join('\n'))).toThrowError('solve expects numeric coefficient elements');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2',
            '  1 0',
            '  0 1',
            'end',
            'A (array 1 "bad") solve',
        ].join('\n'))).toThrowError('solve expects numeric right-side elements');
        expect(() => run('(array shape 1 1 pad 1) (array 1) solve'))
            .toThrowError('unknown name: solve');
    });

    it('contracts vectors and matrices with matmul', () => {
        expect(run('use linalg\n(array 1 2 3) (array 4 5 6) matmul')).toBe('32');
        expect(run([
            'use linalg',
            'IntegerDot = (array 1 2) (array 3 4) matmul',
            'RealDot = (array 1 2.5) (array 2 4) matmul',
            'IntegerDot is .integer and RealDot is .real',
        ].join('\n'))).toBe('true');
        expect(run([
            'use linalg',
            'A = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'A (array 1 2 3) matmul',
        ].join('\n'))).toBe('14 32');
        expect(run([
            'use linalg',
            'B = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            '(array 2 3) B matmul',
        ].join('\n'))).toBe('14 19 24');
        expect(run([
            'use linalg',
            'A = array shape 2 2',
            '  1 2',
            '  2 4',
            'end',
            'B = array shape 2 2',
            '  2 1',
            '  3 4',
            'end',
            'A B matmul',
        ].join('\n'))).toBe('8 9 16 18');
    });

    it('contracts higher tensors without implicit broadcasting', () => {
        expect(run([
            'use linalg',
            'A = array shape 2 2 3',
            '  1 2 3 4 5 6',
            '  7 8 9 10 11 12',
            'end',
            'B = array shape 3 2',
            '  1 0',
            '  0 1',
            '  1 1',
            'end',
            'A B matmul',
        ].join('\n'))).toBe('4 5 10 11 16 17 22 23');
    });

    it('contracts an explicit axis from each operand', () => {
        const source = [
            'use linalg',
            'use sequences',
            'A = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'B = array shape 2 4',
            '  1 0 2 0',
            '  0 1 0 2',
            'end',
            'Result = A B matmul axis 0 0',
        ];
        expect(run([...source, 'Result'].join('\n')))
            .toBe('1 4 2 8 2 5 4 10 3 6 6 12');
        expect(run([...source, 'Result shape'].join('\n'))).toBe('3 4');
    });

    it('keeps empty contractions shaped and lazy', () => {
        const source = [
            'use linalg',
            'use sequences',
            'A = array shape 2 0 pad 0',
            'B = array shape 0 3 pad 0',
            'Result = A B matmul',
        ];
        expect(run([...source, 'Result'].join('\n'))).toBe('0 0 0 0 0 0');
        expect(run([...source, 'Result shape'].join('\n'))).toBe('2 3');

        expect(run([
            'use linalg',
            'A = array shape 2 2',
            '  1 2',
            '  "unused" 4',
            'end',
            'B = array shape 2 2',
            '  1 0',
            '  0 1',
            'end',
            'Result = A B matmul',
            'Result 0 0',
        ].join('\n'))).toBe('1');
        expect(() => run([
            'use linalg',
            'A = array shape 2 2',
            '  1 2',
            '  "invalid" 4',
            'end',
            'B = array shape 2 2 pad 1',
            'Result = A B matmul',
            'Result 1 0',
        ].join('\n'))).toThrowError('expected numeric input');
    });

    it('validates matmul dimensions and axes', () => {
        expect(() => run([
            'use linalg',
            'A = array shape 2 3 pad 1',
            'B = array shape 2 2 pad 1',
            'A B matmul',
        ].join('\n'))).toThrowError('matmul contracted dimensions differ: 3 and 2');
        expect(() => run([
            'use linalg',
            'A = array shape 2 3 pad 1',
            'B = array shape 2 2 pad 1',
            'A B matmul axis 0',
        ].join('\n'))).toThrowError('matmul axis expects one axis for each operand');
        expect(() => run([
            'use linalg',
            'A = array shape 2 3 pad 1',
            'B = array shape 2 2 pad 1',
            'A B matmul axis 2 0',
        ].join('\n'))).toThrowError('matmul left axis out of bounds: 2');
    });

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
