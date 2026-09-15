import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('Rank statistics', () => {
    it('calculates odd and even medians without changing the source', () => {
        expect(run([
            'use stats',
            'Values = array 9 1 4',
            'Result = Values median',
            'array Result Values',
        ].join('\n'))).toBe('4 9 1 4');
        expect(run('use stats\n(array 8 2 4 6) median')).toBe('5');
    });

    it('skips missing table cells in statistical reductions', () => {
        const source = [
            'use json',
            'use stats',
            'use tables',
            'Rows = "[{\\"x\\":1},{},{\\"x\\":3}]" json',
        ];
        expect(run([...source, 'Rows .x median'].join('\n'))).toBe('2');
        expect(run([...source, 'Rows .x mean'].join('\n'))).toBe('2');
        expect(run([...source, 'Rows .x std'].join('\n'))).toBe('1');
        expect(run([...source, '(Rows .x) median axis 0'].join('\n'))).toBe('2');
        expect(run([...source, '(Rows .x) mean axis 0'].join('\n'))).toBe('2');
    });

    it('validates median input and remaining values', () => {
        expect(() => run('use stats\n(array 1 "bad") median'))
            .toThrowError('expected numeric input');
        expect(() => run('use stats\n(array shape 0 fill 0) median'))
            .toThrowError('median requires at least one value');
        expect(() => run([
            'use json',
            'use stats',
            'use tables',
            'Rows = "[{},{}]" json',
            'Rows .x median',
        ].join('\n'))).toThrowError('median requires at least one value');
        expect(() => run('(array 1 2) median'))
            .toThrowError('unknown name: median');
    });

    it('applies median by rank and axis', () => {
        const source = [
            'use stats',
            'M = array shape 2 3',
            '  9 1 4',
            '  2 8 6',
            'end',
        ];
        expect(run([...source, 'M median rank 1'].join('\n'))).toBe('4 6');
        expect(run([...source, 'M median axis 0'].join('\n'))).toBe('5.5 4.5 5');
    });

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

    it('calculates mean squared and absolute errors', () => {
        expect(run('use stats\n3 1 mse')).toBe('4');
        expect(run('use stats\n3 1 mae')).toBe('2');
        expect(run([
            'use stats',
            'Actual = array shape 2 2',
            '  1 4',
            '  3 8',
            'end',
            'Target = array 1 2',
            'Actual Target mse',
        ].join('\n'))).toBe('11');
        expect(run([
            'use stats',
            'Actual = array shape 2 2',
            '  1 4',
            '  3 8',
            'end',
            'Target = array 1 2',
            'Actual Target mae',
        ].join('\n'))).toBe('2.5');
        expect(run([

            'use stats',
            'Actual = 1 to 3',
            'Target = array 1 1 1',
            'Actual Target mae',
        ].join('\n'))).toBe('1');
    });

    it('reduces error metrics over selected axes', () => {
        const source = [
            'use stats',
            'Actual = array shape 2 2',
            '  1 4',
            '  3 8',
            'end',
            'Target = array 1 2',
        ];
        expect(run([...source, 'Actual Target mse axis 1'].join('\n')))
            .toBe('2 20');
        expect(run([...source, 'Actual Target mae axis 1'].join('\n')))
            .toBe('1 4');
        expect(run([...source, 'Actual Target mse axis 0 1'].join('\n')))
            .toBe('11');
    });

    it('keeps framed error reductions lazy', () => {
        expect(run([
            'use stats',
            'Actual = array shape 2 2',
            '  1 2',
            '  "later" 4',
            'end',
            'Target = array 1 1',
            'Result = Actual Target mse axis 1',
            'Result 0',
        ].join('\n'))).toBe('0.5');
    });

    it('validates error metric inputs and axes', () => {
        expect(() => run('3 1 mse')).toThrowError('unknown name: mse');
        expect(() => run('use stats\n"bad" 1 mae'))
            .toThrowError('expected numeric input');
        expect(() => run([
            'use stats',
            '(array 1 2) (array 1 2 3) mse',
        ].join('\n'))).toThrowError('shape mismatch');
        expect(() => run([
            'use stats',
            'A = array shape 0 fill 0',
            'A A mse',
        ].join('\n'))).toThrowError('mse requires at least one value');
        expect(() => run('use stats\n(array 1) (array 1) mae axis 1'))
            .toThrowError('array has no axis 1');
        expect(() => run('use stats\n(array 1) (array 1) mse axis 0 0'))
            .toThrowError('mse axes must be unique');
        expect(() => run('use stats\n(array 1) (array 1) mse axis'))
            .toThrowError('mse axis expects one or more axes');
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
            'Data = array shape 0 3 fill 0',
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
        expect(() => run('use stats\n(array shape 2 1 fill 0) covariance'))
            .toThrowError('covariance requires at least two observations');
        expect(() => run('use stats\n(array shape 2 3 fill 0) covariance axis 0'))
            .toThrowError('covariance axis expects feature and observation axes');
        expect(() => run('use stats\n(array shape 2 3 fill 0) covariance axis 0 0'))
            .toThrowError('covariance axes must be unique');
        expect(() => run('use stats\n(array shape 2 3 fill 0) covariance axis 0 2'))
            .toThrowError('covariance axis out of bounds: 2');
    });
});
