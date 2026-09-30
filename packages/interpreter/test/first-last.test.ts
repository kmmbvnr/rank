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
