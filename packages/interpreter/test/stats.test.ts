import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('Rank statistics', () => {
    it('calculates population standard deviation', () => {
        expect(run([
            'use numbers',
            'use stats',
            'Values = array 1 2 3',
            'Result = Values std',
            'Result round 6',
        ].join('\n'))).toBe('0.816497');
        expect(run('use stats\n(array 7) std')).toBe('0');
    });

    it('applies standard deviation by rank and axis', () => {
        const source = [
            'use numbers',
            'use stats',
            'M = array shape 2 3',
            '  1 2 3',
            '  4 4 4',
            'end',
        ];
        expect(run([...source, 'Result = M std rank 1', 'Result round 6'].join('\n')))
            .toBe('0.816497 0');
        expect(run([...source, 'Result = M std axis 0', 'Result round 6'].join('\n')))
            .toBe('1.5 1 0.5');
    });

    it('validates standard-deviation input', () => {
        expect(() => run([
            'use stats',
            'Empty = array shape 0',
            'end',
            'Empty std',
        ].join('\n'))).toThrowError('std requires at least one value');
        expect(() => run('use stats\n(array 1 "bad") std'))
            .toThrowError('expected numeric input');
        expect(() => run('use numbers\nuse stats\n(array 1 infinity) std'))
            .toThrowError('std expects finite values');
        expect(() => run('(array 1 2) std'))
            .toThrowError('unknown name: std');
    });

    it('calculates sample covariance for feature rows', () => {
        expect(run([
            'use stats',
            'V = array shape 2 3',
            '  1 2 3',
            '  4 5 6',
            'end',
            'V covariance',
        ].join('\n'))).toBe('1 1 1 1');
    });

    it('selects feature and observation axes', () => {
        expect(run([
            'use stats',
            'Data = array shape 3 2',
            '  1 4',
            '  2 5',
            '  3 6',
            'end',
            'Data covariance axis 1 0',
        ].join('\n'))).toBe('1 1 1 1');
    });

    it('preserves other axes as independent batches', () => {
        const source = [
            'use stats',
            'use sequences',
            'Data = array shape 2 2 3',
            '  1 2 3 1 3 5',
            '  4 5 6 2 6 10',
            'end',
            'Result = Data covariance axis 0 2',
        ];
        expect(run([...source, 'Result'].join('\n'))).toBe('1 1 1 1 4 8 8 16');
        expect(run([...source, 'Result shape'].join('\n'))).toBe('2 2 2');
    });

    it('supports empty feature axes', () => {
        expect(run([
            'use stats',
            'use sequences',
            'Data = array shape 0 3 pad 0',
            'Result = Data covariance',
            'Result shape',
        ].join('\n'))).toBe('0 0');
    });

    it('evaluates batches lazily', () => {
        const source = [
            'use stats',
            'Data = array shape 2 2 3',
            '  1 2 3 4 5 6',
            '  "invalid" 2 3 4 5 6',
            'end',
            'Result = Data covariance',
        ];
        expect(run([...source, 'Result 0 0 0'].join('\n'))).toBe('1');
        expect(() => run([...source, 'Result 1 0 0'].join('\n')))
            .toThrowError('expected numeric input');
    });

    it('validates observation counts and axes', () => {
        expect(() => run('use stats\n(array shape 2 1 pad 0) covariance'))
            .toThrowError('covariance requires at least two observations');
        expect(() => run('use stats\n(array shape 2 3 pad 0) covariance axis 0'))
            .toThrowError('covariance axis expects feature and observation axes');
        expect(() => run('use stats\n(array shape 2 3 pad 0) covariance axis 0 0'))
            .toThrowError('covariance axes must be unique');
        expect(() => run('use stats\n(array shape 2 3 pad 0) covariance axis 0 2'))
            .toThrowError('covariance axis out of bounds: 2');
    });
});
