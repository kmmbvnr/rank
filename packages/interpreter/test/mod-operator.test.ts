import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const numbers = (...lines: string[]) => run(['use sequences', ...lines].join('\n'));

describe('mod', () => {
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
