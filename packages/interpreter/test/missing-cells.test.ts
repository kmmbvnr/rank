import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('missing cells (.NA)', () => {
    it('is a value that prints as written and has its own type', () => {
        expect(run('.NA')).toBe('.NA');
        expect(run('array 1.0 2.0 .NA')).toBe('1 2 .NA');
        expect(run('.NA type')).toBe('.missing');
        expect(run('.NA is .missing')).toBe('true');
        expect(run('1 is .missing')).toBe('false');
        expect(run('X = .NA\nX')).toBe('.NA');
    });

    it('propagates through arithmetic and comparison', () => {
        expect(run('.NA + 1')).toBe('.NA');
        expect(run('2 * .NA')).toBe('.NA');
        expect(run('-.NA')).toBe('.NA');
        expect(run('.NA greater 1')).toBe('.NA');
        expect(run('.NA equal .NA')).toBe('.NA');
        expect(run('(array 1.0 .NA 3.0) + 1')).toBe('2 .NA 4');
        expect(run('(array 1 2) + .NA')).toBe('.NA .NA');
        expect(run('(array 1.0 .NA 3.0) greater 2')).toBe('false .NA true');
    });

    it('follows three-valued logic', () => {
        expect(run('false and .NA')).toBe('false');
        expect(run('.NA and false')).toBe('false');
        expect(run('true and .NA')).toBe('.NA');
        expect(run('true or .NA')).toBe('true');
        expect(run('.NA or true')).toBe('true');
        expect(run('false or .NA')).toBe('.NA');
        expect(run('true xor .NA')).toBe('.NA');
        expect(run('not .NA')).toBe('.NA');
    });

    it('raises .Missing where a definite value is required', () => {
        expect(() => run('if .NA\n    1\nend')).toThrowError('missing value');
        expect(run('X = (.NA and true) default false\nX')).toBe('false');
    });

    it('is filled by default, and present masks it', () => {
        expect(run('.NA default 0')).toBe('0');
        expect(run('(array 1.0 .NA 3.0) default 0.0')).toBe('1 0 3');
        expect(run('(array 1.0 .NA 3.0) present')).toBe('true false true');
        expect(run('.NA present')).toBe('false');
        expect(run('5 present')).toBe('true');
        expect(run('use sequences\n(array 1.0 .NA 3.0) present false find')).toBe('1');
    });

    it('is skipped by reductions', () => {
        expect(run('(array 1 .NA 3) sum')).toBe('4');
        expect(run('(array 1.5 .NA 3.0) sum')).toBe('4.5');
        expect(run('(array 4 .NA 3) min')).toBe('3');
        expect(run('(array 4 .NA 3) max')).toBe('4');
        expect(run('use stats\n(array 1.0 .NA 5.0) mean')).toBe('3');
        expect(run('use stats\n(array 1.0 .NA 5.0 9.0) median')).toBe('5');
        expect(run('.NA 1 min')).toBe('.NA');
    });

    it('keeps nan a number apart from missing', () => {
        expect(run('use numbers\n(array 1.0 nan .NA) present')).toBe('true true false');
        expect(run('use numbers\n(array 1.0 nan .NA) isnan')).toBe('false true false');
    });
});
