import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('Rank mathematical functions', () => {
    it('evaluates circular trigonometric functions in radians', () => {
        expect(run('use numbers\n0 sin')).toBe('0');
        expect(run('use numbers\n0 cos')).toBe('1');
        expect(run('use numbers\n0 tan')).toBe('0');
        expect(run('use numbers\n1 asin')).toBe('1.5707963267948966');
        expect(run('use numbers\n1 acos')).toBe('0');
        expect(run('use numbers\n1 atan')).toBe('0.7853981633974483');
    });

    it('uses both coordinates and their quadrant for atan2', () => {
        expect(run('use numbers\n1 1 atan2')).toBe('0.7853981633974483');
        expect(run('use numbers\n(-1) (-1) atan2')).toBe('-2.356194490192345');
        expect(run('use numbers\n1 0 atan2')).toBe('1.5707963267948966');
    });

    it('evaluates hyperbolic functions and their inverses', () => {
        expect(run('use numbers\n0 sinh')).toBe('0');
        expect(run('use numbers\n0 cosh')).toBe('1');
        expect(run('use numbers\n0 tanh')).toBe('0');
        expect(run('use numbers\n0 asinh')).toBe('0');
        expect(run('use numbers\n1 acosh')).toBe('0');
        expect(run('use numbers\n0 atanh')).toBe('0');
    });

    it('maps trigonometric functions lazily while preserving tensor shape', () => {
        const value = new Interpreter().execute([
            'use numbers',
            'Values = array shape 2 2',
            '  0 1',
            '  2 3',
            'end',
            'Values sin',
        ].join('\n'));
        expect(value).toMatchObject({ kind: 'array', shape: [2, 2] });

        expect(run([
            'use numbers',
            'Values = array 0 "later"',
            'Result = Values cos',
            'Result 0',
        ].join('\n'))).toBe('1');
    });

    it('maps atan2 over compatible arrays and scalar broadcasts', () => {
        expect(run([
            'use numbers',
            'Y = array 0 1',
            'X = array 1 0',
            'Y X atan2',
        ].join('\n'))).toBe('0 1.5707963267948966');
        expect(run('use numbers\n(array 0 1) 1 atan2')).toBe('0 0.7853981633974483');
        expect(run([
            'use numbers',
            'Y = array shape 2 1 pad 1',
            'X = array 1 -1',
            'Y X atan2',
        ].join('\n'))).toBe([
            '0.7853981633974483',
            '2.356194490192345',
            '0.7853981633974483',
            '2.356194490192345',
        ].join(' '));
        expect(run([
            'use numbers',
            'Y = array shape 2 1 pad 1',
            'X = array 1 -1',
            'Y X atan2',
        ].join('\n'))).toBe(
            '0.7853981633974483 2.356194490192345 0.7853981633974483 2.356194490192345',
        );
        expect(run('use numbers\n(array 0 1) (array 1 0) atan2 outer'))
            .toBe('0 0 0.7853981633974483 1.5707963267948966');
        expect(run([
            'use numbers',
            'use ranges',
            '(0 to 1) (1 to 2) atan2',
        ].join('\n'))).toBe('0 0.4636476090008061');
    });

    it('reports type, shape and mathematical domain errors', () => {
        expect(() => run('use numbers\n"x" sin'))
            .toThrowError('sin expects numeric input');
        expect(() => run('use numbers\n2 asin'))
            .toThrowError('asin input is outside its domain');
        expect(() => run('use numbers\n0 acosh'))
            .toThrowError('acosh input is outside its domain');
        expect(() => run('use numbers\n1 atanh'))
            .toThrowError('atanh input is outside its domain');
        expect(() => run('use numbers\ninfinity sin'))
            .toThrowError('sin input is outside its domain');
        expect(() => run('use numbers\n(array 0 1) (array 1 2 3) atan2'))
            .toThrowError('shape mismatch');
    });
});
