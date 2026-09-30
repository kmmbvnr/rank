import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

const show = (runtime: Interpreter, source: string) => formatValue(runtime.execute(source)!);

describe('first and last', () => {
    it('read the ends of arrays, text, sequences and queues', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nuse algo');
        expect(show(runtime, '(array 10 20 30) first')).toBe('10');
        expect(show(runtime, '(array 10 20 30) last')).toBe('30');
        expect(show(runtime, '"abc" first')).toBe('a');
        expect(show(runtime, '"abc" last')).toBe('c');
        expect(show(runtime, 'primes till 20 last')).toBe('19');
        expect(show(runtime, 'primes first')).toBe('2');
        runtime.execute('D = new deque\nD 4 pushback\nD 9 pushback');
        expect(show(runtime, 'D first')).toBe('4');
        expect(show(runtime, 'D last')).toBe('9');
    });

    it('take a leading-axis row of a matrix', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nM = (array 1 2 3 4 5 6) (array 3 2) reshape');
        expect(show(runtime, 'M first')).toBe('1 2');
        expect(show(runtime, 'M last')).toBe('5 6');
    });

    it('are missing on an empty collection and accept a default', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences');
        expect(() => runtime.execute('"" first')).toThrowError('empty');
        runtime.execute('Empty = (array 1 2) take 0');
        expect(() => runtime.execute('Empty last')).toThrowError('empty');
        expect(show(runtime, '"" last default "-"')).toBe('-');
    });

    it('reject values without an order', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences');
        expect(() => runtime.execute('5 last')).toThrowError('expects');
    });
});

describe('reverse', () => {
    it('reverses text, arrays along the leading axis and finite sequences', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences');
        expect(show(runtime, '"A😀Б" reverse')).toBe('Б😀A');
        expect(show(runtime, '(array 1 2 3) reverse')).toBe('3 2 1');
        expect(show(runtime, '(array "a" "b") reverse')).toBe('b a');
        expect(show(runtime, 'primes till 12 reverse')).toBe('11 7 5 3 2');
        runtime.execute('use algo\nQ = new queue\nQ push 1\nQ push 2\nQ push 3');
        expect(show(runtime, 'Q reverse')).toBe('3 2 1');
        expect(show(runtime, 'Q len')).toBe('3');
        runtime.execute('M = (array 1 2 3 4 5 6) (array 3 2) reshape\nR = M reverse');
        expect(show(runtime, 'R 0')).toBe('5 6');
        expect(show(runtime, 'R 2')).toBe('1 2');
        expect(show(runtime, 'R shape')).toBe('3 2');
    });

    it('handles empty and single-item inputs and leaves the source alone', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nA = array 1 2 3\nB = A reverse\nB 0 = 9');
        expect(show(runtime, 'A')).toBe('1 2 3');
        expect(show(runtime, '(array 7) reverse')).toBe('7');
        expect(show(runtime, '"" reverse')).toBe('');
        expect(show(runtime, '((array 1 2) take 0) reverse len')).toBe('0');
    });

    it('rejects unbounded sequences and values without an order', () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences');
        expect(() => runtime.execute('primes reverse')).toThrowError('finite');
        expect(() => runtime.execute('5 reverse')).toThrowError('expects');
    });
});
