import { describe, expect, it } from 'vitest';
import { Interpreter, RankError } from '../src/index.js';
import { run } from './support.js';

describe('floor modulo', () => {
    it('keeps real quotients consistent with remainders near integer boundaries', () => {
        const interpreter = new Interpreter();
        for (const [a, b, expected] of [
            [1, 0.1, 9], [-1, 0.1, -10], [1, -0.1, -10], [-1, -0.1, 9],
            [1, 0.01, 99], [5.5, 3, 1], [-5.5, 3, -2],
        ]) {
            interpreter.execute(`A = ${a.toFixed(2)}\nB = ${b.toFixed(2)}`);
            expect(interpreter.execute('A // B')).toBe(expected);
            expect(interpreter.execute('(A // B) * B + A % B')).toBeCloseTo(a, 14);
        }
        expect(run('1 // 0.1')).toBe('9');
        expect(run('X = 1.0\nX //= 0.1\nX')).toBe('9');
        expect(run('(array 1.0 (-1.0)) // 0.1')).toBe('9 -10');
        expect(interpreter.execute('-0.0 // 3.0')).toBe(-0);
        expect(interpreter.execute('0.0 // -3.0')).toBe(-0);
    });

    it('raises Rank errors for divisibility by zero without changing valid predicates', () => {
        for (const a of ['5', '0', '-5']) {
            expect(() => run(`use numbers\n${a} multiple by 0`)).toThrowError(RankError);
            expect(() => run(`use numbers\n${a} multiple by 0`)).toThrowError('division by zero');
        }
        expect(run('use numbers\n-6 multiple by 3')).toBe('true');
        expect(run('use numbers\n6 multiple by -3')).toBe('true');
        expect(run('use numbers\n-5 multiple by 3')).toBe('false');
        expect(run('use numbers\n0 multiple by 3')).toBe('true');
    });

    it('uses the divisor sign for integer, real and mixed operands', () => {
        for (const [a, b, expected] of [
            ['-5', '3', '1'], ['5', '-3', '-1'],
            ['-5', '-3', '-2'], ['5', '3', '2'],
            ['-5.5', '3.0', '0.5'], ['5.5', '-3.0', '-0.5'],
            ['-5.5', '-3.0', '-2.5'], ['5.5', '3.0', '2.5'],
            ['-5', '3.0', '1'], ['5.0', '-3', '-1'],
        ]) {
            expect(run(`(${a}) % (${b})`)).toBe(expected);
        }
    });

    it('preserves exact integer division identities beyond Number precision', () => {
        const interpreter = new Interpreter();
        interpreter.execute('fun remainder A B\nreturn A % B\nend\nfun quotient A B\nreturn A // B\nend');
        for (const a of [-1000000000000000000000000000001n, -6n, -5n, -1n, 0n, 1n, 5n, 6n, 1000000000000000000000000000001n]) {
            for (const b of [-7n, -3n, -1n, 1n, 3n, 7n]) {
                const r = interpreter.execute(`(${a}) (${b}) remainder`) as bigint;
                const q = interpreter.execute(`(${a}) (${b}) quotient`) as bigint;
                expect(q * b + r).toBe(a);
                expect(r === 0n || (r < 0n) === (b < 0n)).toBe(true);
                expect(r < 0n ? -r : r).toBeLessThan(b < 0n ? -b : b);
            }
        }
    });

    it('gives real zero the divisor sign', () => {
        const interpreter = new Interpreter();
        expect(interpreter.execute('-6.0 % 3.0')).toBe(0);
        expect(interpreter.execute('6.0 % -3.0')).toBe(-0);
        expect(interpreter.execute('0.0 % -3.0')).toBe(-0);
        expect(interpreter.execute('-6 % 3')).toBe(0n);
    });

    it('applies the same rule in compound assignments and arrays', () => {
        expect(run('Value = -5\nValue %= 3\nValue')).toBe('1');
        expect(run('Values = array (-5) 5\nValues 0 %= 3\nValues')).toBe('1 5');
        expect(run('(array (-5) 5) % 3')).toBe('1 2');
        expect(run('(array (-5) 5) % -3')).toBe('-2 -1');
        expect(run('(-5 to -3) % 3')).toBe('1 2 0');
    });

    it('keeps positive-modulus normalization valid', () => {
        expect(run('X = -5\nM = 3\n((X % M + M) % M) equal (X % M)')).toBe('true');
    });

    it('rejects zero divisors as Rank errors', () => {
        for (const expression of ['5 % 0', '5 % 0.0', '5.0 % -0.0', '5 // 0']) {
            expect(() => run(expression)).toThrowError('division by zero');
        }
    });
});
