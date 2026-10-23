import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const numbers = (...lines: string[]) => run(['use sequences', ...lines].join('\n'));

describe('mod', () => {
    it('combines scalar pairs in an outer product', () => {
        expect(run('(array 1 2 3) (array 1 2) outer mod')).toBe('0 1 0 0 0 1');
        expect(run('(array (-7) 7) (array 3 (-3)) outer mod')).toBe('2 -1 1 -2');
        expect(run('(array 5.5 (-5.5)) (array 2.0 (-2.0)) outer mod')).toBe('1.5 -0.5 0.5 -1.5');
    });

    it('scans and reduces from the left, with an optional seed', () => {
        expect(run('(array 20 6 3) scan mod')).toBe('20 2 2');
        expect(run('(array 20 6 3) reduce mod')).toBe('2');
        expect(run('(array 20 6 3) scan mod with 43')).toBe('43 3 3 0');
        expect(run('(array 20 6 3) reduce mod with 43')).toBe('0');
        expect(run('(array (-7) 3 (-2)) scan mod')).toBe('-7 2 0');
        expect(run('(array 5.5 2.0 1.0) reduce mod')).toBe('0.5');
    });

    it('preserves axis, rank and following pipeline modifiers', () => {
        const source = 'use sequences\nM = array shape 2 3\n 20 6 3\n 17 5 2\nend\n';
        expect(run(source + 'M reduce mod rank 1')).toBe('2 0');
        expect(run(source + 'M reduce mod axis 0')).toBe('3 1 1');
        expect(run(source + 'M scan mod axis 1')).toBe('20 2 2 17 2 0');
        expect(run(source + 'M scan mod rank 1 with 43 shape')).toBe('2 4');
        expect(numbers('(array 20 6 3) scan mod sum')).toBe('24');
    });

    it.each([
        '(array 1 2) (array 1 0) outer mod',
        '(array 20 0) scan mod',
        '(array 20 0) reduce mod',
    ])('preserves division by zero errors for %s', source => {
        expect(() => run(source)).toThrow('division by zero');
    });

    it.each(['modcombine', 'mod2', 'mod_combine'])('keeps the user function name %s intact', name => {
        const source = `fun A B ${name} rank 0 0\n return A mod B\nend\n`;
        expect(run(source + `(array 20 6) (array 3 4) outer ${name}`)).toBe('2 0 0 2');
        expect(run(source + `(array 20 6 3) scan ${name}`)).toBe('20 2 2');
        expect(run(source + `(array 20 6 3) reduce ${name}`)).toBe('2');
    });

    it.each(['outer', 'scan', 'reduce', 'segment'])('rejects retired spellings after %s', operation => {
        const source = 'use algo\n';
        expect(() => run(source + `(array 1 2) ${operation} %`)).toThrow(/the remainder is written `mod`/);
        expect(() => run(source + `(array 1 2) ${operation} multiple by 3`)).toThrow();
    });

    it('rejects a non-associative segment operation', () => {
        expect(() => run('use algo\n(array 20 6 3) segment mod')).toThrow('segment requires an associative operation');
    });

    it('is the floored remainder, as a binary operator and in place', () => {
        expect(run('17 mod 5')).toBe('2');
        expect(run('-7 mod 3')).toBe('2');
        expect(run('7 mod -3')).toBe('-2');
        expect(run('5.5 mod 2.0')).toBe('1.5');
        expect(run('Total = 100\nTotal mod= 7\nTotal')).toBe('2');
        expect(() => run('5 mod 0')).toThrow('division by zero');
    });

    it('binds like * and //, tighter than + and comparisons', () => {
        expect(run('1 + 7 mod 4 * 2')).toBe('7');
        expect(run('10 mod 4 equal 2')).toBe('true');
    });

    it('tests divisibility elementwise with equal 0', () => {
        expect(numbers('(1 to 10) mod 3 equal 0')).toBe('false false true false false true false false true false');
        expect(numbers('N = 1 to 10', 'N (N mod 4 equal 0)')).toBe('4 8');
    });

    it('is no longer spelled with a percent sign or multiple by', () => {
        expect(() => run('17 % 5')).toThrow(/the remainder is written `mod`/);
        expect(() => run('12 multiple by 3')).toThrow();
    });
});

describe('filter with an elided subject step', () => {
    it('applies a multiplicative step before the comparison', () => {
        expect(numbers('N = 1 to 10', 'N filter mod 3 equal 0')).toBe('3 6 9');
        expect(numbers('N = 1 to 10', 'N filter // 2 equal 2')).toBe('4 5');
        expect(numbers('N = 1 to 10', 'N filter * 2 greater 15')).toBe('8 9 10');
    });

    it('combines steps and plain comparisons with and, or and not', () => {
        expect(numbers('N = 1 to 10', 'N filter mod 3 equal 0 or mod 5 equal 0')).toBe('3 5 6 9 10');
        expect(numbers('N = 1 to 10', 'N filter mod 2 equal 1 and greater 4')).toBe('5 7 9');
        expect(numbers('N = 1 to 10', 'N filter mod 2 equal 1 or greater 8')).toBe('1 3 5 7 9 10');
    });

    it('stays lazy and bounded over an endless sequence', () => {
        expect(numbers('fibonacci (fibonacci mod 5 equal 0 or fibonacci mod 3 equal 0) till 100'))
            .toBe('3 5 21 55');
        expect(numbers('primes (primes mod 5 equal 0 or primes mod 3 equal 0) till 100')).toBe('3 5');
    });
});
