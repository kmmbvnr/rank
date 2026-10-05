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
        runtime.execute('use sequences\nM = (array 1 2 3 4 5 6) reshape 3 2');
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
        expect(show(runtime, '"😀𝄞" reverse')).toBe('𝄞😀');
        runtime.variables.set('Unpaired', '\ud83dA');
        expect(runtime.execute('Unpaired reverse')).toBe('A\ud83d');
        expect(show(runtime, '(array 1 2 3) reverse')).toBe('3 2 1');
        expect(show(runtime, '(array "a" "b") reverse')).toBe('b a');
        expect(show(runtime, 'primes till 12 reverse')).toBe('11 7 5 3 2');
        runtime.execute('use algo\nQ = new queue\nQ push 1\nQ push 2\nQ push 3');
        expect(show(runtime, 'Q reverse')).toBe('3 2 1');
        expect(show(runtime, 'Q len')).toBe('3');
        runtime.execute('M = (array 1 2 3 4 5 6) reshape 3 2\nR = M reverse');
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

describe('postfix array on containers', () => {
    const fresh = () => {
        const runtime = new Interpreter();
        runtime.execute('use sequences\nuse algo');
        return runtime;
    };

    it('copies a queue, stack or deque in iteration order and keeps the source', () => {
        const runtime = fresh();
        runtime.execute('Q = new queue\nQ push 1\nQ push 2\nQ push 3');
        expect(show(runtime, 'Q array')).toBe('1 2 3');
        expect(show(runtime, 'Q array reverse')).toBe('3 2 1');
        expect(show(runtime, 'Q len')).toBe('3');
        runtime.execute('A = Q array\nA 0 = 9\nB = Q array');
        expect(show(runtime, 'B')).toBe('1 2 3');
        runtime.execute('S = new stack\nS push 4\nS push 5');
        expect(show(runtime, 'S array')).toBe('4 5');
        runtime.execute('D = new deque\nD 4 pushback\nD 3 pushfront');
        expect(show(runtime, 'D array')).toBe('3 4');
    });

    it('handles empty and single-item containers and keeps element types', () => {
        const runtime = fresh();
        runtime.execute('E = new queue\nT = new queue\nT push "a"\nP = new queue\nP push (array 1 2)\nP push (array 3 4)');
        expect(show(runtime, 'E array len')).toBe('0');
        expect(show(runtime, 'T array')).toBe('a');
        expect(show(runtime, 'P array 1')).toBe('3 4');
        expect(show(runtime, 'P array len')).toBe('2');
    });

    it('copies sets and multisets and rejects containers without a defined order', () => {
        const runtime = fresh();
        runtime.execute('X = new set\nX add 3\nX add 3\nX add 1\nM = new orderedset\nM add 5\nM add 2');
        expect(show(runtime, 'X array len')).toBe('2');
        expect(show(runtime, 'M array')).toBe('2 5');
        runtime.execute('H = new heap\nC = new counter');
        expect(() => runtime.execute('H array')).toThrowError('postfix array expects');
        expect(() => runtime.execute('C array')).toThrowError('postfix array expects');
    });
});

describe('gathering from an index', () => {
    const P = 'use algo\nuse sequences\nP = new index\nP 1 = 10\nP 2 = 20\nP 3 = 30\n';
    const run = (source: string) => show(new Interpreter(), P + source);
    it('answers one value per key, keeping the key shape', () => {
        expect(run('Keys = (array 3 1 2) \nP Keys')).toBe('30 10 20');
        expect(run('Keys = (array 1 2 3 1) reshape 2 2\n(P Keys) shape')).toBe('2 2');
    });
    it('reads a finite sequence of keys', () => {
        expect(run('P (1 till 3)')).toBe('10 20');
    });
    it('fills absent keys under default', () => {
        expect(run('Keys = (array 1 9)\nP Keys default 0')).toBe('10 0');
    });
    it('raises on an absent key without default', () => {
        expect(() => run('Keys = (array 1 9)\nP Keys')).toThrow('missing keyed value');
    });
});
