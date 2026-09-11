import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('Rank mathematical functions', () => {
    it('calculates exact and modular binomials', () => {
        expect(run('use numbers\n5 2 binomial')).toBe('10');
        expect(run('use numbers\n100 50 binomial')).toBe(
            '100891344545564193334812497256',
        );
        expect(run('use numbers\n5 2 7 binomialmod')).toBe('3');
        expect(run('use numbers\n(array 5 6) 2 binomial')).toBe('10 15');
        expect(run('use numbers\n1000000 500000 1000000007 binomialmod'))
            .toBe('996692777');
        expect(() => run('use numbers\n4 5 binomial'))
            .toThrowError('0 at most K at most N');
        expect(() => run('use numbers\n5 2 8 binomialmod'))
            .toThrowError('modulus must be prime');
        expect(() => run('use numbers\n7 2 7 binomialmod'))
            .toThrowError('requires N less than its modulus');
        expect(() => run('use numbers\n5 2 18446744073709551629 binomialmod'))
            .toThrowError('64-bit limit');
    });

    it('enumerates and counts positive divisors', () => {
        expect(run('use numbers\n1 divisors')).toBe('1');
        expect(run('use numbers\n12 divisors')).toBe('1 2 3 4 6 12');
        expect(run([
            'use numbers',
            'use sequences',
            '73513440 divisors count',
        ].join('\n'))).toBe('768');
        expect(run('use numbers\n3 in (12 divisors)')).toBe('true');
        expect(run('use numbers\n5 in (12 divisors)')).toBe('false');
        expect(() => run('use numbers\n0 divisors'))
            .toThrowError('divisors expects a positive integer');
    });

    it('uses postfix reductions and infix min/max chains', () => {
        expect(run('use numbers\n(array 3 1 2) max')).toBe('3');
        expect(run('use numbers\n(array 3 1 2) min')).toBe('1');
        expect(run('use numbers\n3 min 1 min 2')).toBe('1');
        expect(run('use numbers\n9 min 4 max 7')).toBe('7');
        expect(run('use numbers\n3 max (1 + 4)')).toBe('5');
        expect(run('use numbers\n(array 1 4) max 3')).toBe('3 4');
        expect(run([
            'use numbers',
            'M = array shape 2 2',
            '  1 7',
            '  4 2',
            'end',
            'M 0 max',
        ].join('\n'))).toBe('7');
        expect(run('use numbers\n3 2 max')).toBe('3');
        expect(() => run('3 max 2'))
            .toThrowError('use numbers');
    });

    it('reduces numeric sets', () => {
        const source = [
            'use algo',
            'use numbers',
            'Values = new set',
            'Values add 7',
            'Values add 2',
            'Values add 7',
        ];
        expect(run([...source, 'Values sum'].join('\n'))).toBe('9');
        expect(run([...source, 'Values min'].join('\n'))).toBe('2');
        expect(run([...source, 'Values max'].join('\n'))).toBe('7');
    });

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

    it('evaluates natural logarithms lazily at scalar rank', () => {
        expect(run('use numbers\n1 log')).toBe('0');
        expect(run('use numbers\n2 log')).toBe('0.6931471805599453');
        expect(run('use numbers\n(array 1 2) log')).toBe('0 0.6931471805599453');
        expect(run([
            'use numbers',
            'Values = array 1 "later"',
            'Logs = Values log',
            'Logs 0',
        ].join('\n'))).toBe('0');
    });

    it('evaluates natural exponentials lazily at scalar rank', () => {
        expect(run('use numbers\n0 exp')).toBe('1');
        expect(run('use numbers\n1 exp')).toBe('2.718281828459045');
        expect(run('use numbers\n(array 0 1) exp'))
            .toBe('1 2.718281828459045');
        expect(run('use numbers\nuse ranges\n(0 to 1) exp'))
            .toBe('1 2.718281828459045');
        expect(run([
            'use numbers',
            'Values = array 0 "later"',
            'Powers = Values exp',
            'Powers 0',
        ].join('\n'))).toBe('1');
        expect(run('use numbers\n(-infinity) exp')).toBe('0');
        expect(run('use numbers\ninfinity exp')).toBe('infinity');
        expect(run('use numbers\n1000 exp')).toBe('infinity');
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
        expect(() => run('use numbers\n0 log'))
            .toThrowError('log input is outside its domain');
        expect(() => run('use numbers\ninfinity log'))
            .toThrowError('log input is outside its domain');
        expect(() => run('use numbers\n"x" log'))
            .toThrowError('log expects numeric input');
        expect(() => run('use numbers\n"x" exp'))
            .toThrowError('exp expects numeric input');
        expect(() => run('1 log'))
            .toThrowError('unknown name: log');
        expect(() => run('1 exp'))
            .toThrowError('unknown name: exp');
        expect(() => run('use numbers\n(array 0 1) (array 1 2 3) atan2'))
            .toThrowError('shape mismatch');
    });
});
