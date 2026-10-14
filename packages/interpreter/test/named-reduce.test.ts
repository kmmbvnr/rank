import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const subtract = 'fun subtract A B\n  return A - B\nend\n';

describe('named reduce', () => {
    it('folds from the left, with or without a seed', () => {
        expect(run(subtract + '(array 10 3 2) reduce subtract')).toBe('5');
        expect(run(subtract + '(array 10 3 2) reduce subtract with 20')).toBe('5');
        expect(run(subtract + '(1 to 4) reduce subtract with 20')).toBe('10');
    });

    it('keeps the seed and supports a different accumulator type', () => {
        expect(run('fun append Text N\n  return Text + (N text)\nend\n'
            + '(1 to 3) reduce append with ""')).toBe('123');
        expect(run(subtract + 'Empty = array shape 0 fill 0\nEmpty reduce subtract with 7')).toBe('7');
        expect(() => run(subtract + 'Empty = array shape 0 fill 0\nEmpty reduce subtract'))
            .toThrow(/initial value.*empty/);
    });

    it('handles one item, scalars, tensors and shared collection sources', () => {
        expect(run(subtract + '(array 7) reduce subtract')).toBe('7');
        expect(run(subtract + '7 reduce subtract with 10')).toBe('3');
        expect(run(subtract + 'M = array shape 2 2\n  1 2\n  3 4\nend\nM reduce subtract with 20')).toBe('10');
        expect(run('use algo\n' + subtract + 'Q = new queue\nQ push 3\nQ push 2\nQ reduce subtract with 10')).toBe('5');
    });

    it('accepts builtins and continues the result pipeline', () => {
        expect(run('(array 3 1 2) reduce min with 9')).toBe('1');
        expect(run(subtract + '(array 10 3 2) reduce subtract with (20 + 1) text len')).toBe('1');
        expect(run(subtract + '(array 10 3 2) reduce subtract text len')).toBe('1');
    });

    it.each(['add', 'remove', 'combineadd', 'combineremove'])('does not confuse %s with collection mutation', name => {
        expect(run(`fun ${name} A B\n  return A + B\nend\nValues = array 2 3 4\nValues reduce ${name} with 0`)).toBe('9');
    });

    it('rejects operations without a binary arity and unbounded sources', () => {
        expect(() => run('(array 1 2) reduce len with 0')).toThrow(/binary operation/);
        expect(() => run('use sequences\n' + subtract + 'primes reduce subtract with 0')).toThrow(/bounded sequence/);
    });
});
