import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const algo = (...lines: string[]) => run(['use algo', 'use sequences', ...lines].join('\n'));

describe('new Kind Items', () => {
    it('fills a queue, stack, deque and heap by pushing each item in order', () => {
        expect(algo('Q = new queue (array 3 1 2)', 'tuple (Q pop) (Q pop) (Q len)')).toBe('3 1 1');
        expect(algo('S = new stack (1 to 4)', 'tuple (S pop) (S len)')).toBe('4 3');
        expect(algo('D = new deque (array 5 6)', 'D popback')).toBe('6');
        expect(algo('H = new heap (array 5 1 3)', 'tuple (H pop) (H pop)')).toBe('1 3');
    });

    it('fills a set, counter and multiset by adding each item', () => {
        expect(algo('S = new set "hello"', 'S len')).toBe('4');
        expect(algo('C = new counter (array 1 1 2)', 'tuple (C 1) (C len)')).toBe('2 2');
        expect(algo('M = new multiset (array 3 3 1)', 'M len')).toBe('3');
    });

    it('starts empty without items and refuses extra operands', () => {
        expect(algo('Q = new queue', 'Q len')).toBe('0');
        expect(() => algo('Q = new queue 1 2')).toThrow(/takes one collection/);
    });

    it('needs the algo module', () => {
        expect(() => run('Q = new queue (array 1)')).toThrow('new requires: use algo');
    });
});

describe('push unpack', () => {
    it('appends each item, while a plain push keeps an array as one element', () => {
        expect(algo('Q = new queue', 'Q push 1', 'Q push unpack (array 7 8 9)', 'tuple (Q len) (Q pop) (Q pop)')).toBe('4 1 7');
        expect(algo('Q = new queue', 'Q push (array 7 8 9)', 'Q len')).toBe('1');
        expect(algo('H = new heap', 'H push unpack (array 5 2 8)', 'H pop')).toBe('2');
    });
});

describe('the retired implicit structures', () => {
    it('explain how to name one instead', () => {
        for (const word of ['queue', 'set', 'counter', 'index']) {
            expect(() => run(`use algo\nX = ${word}`)).toThrow(new RegExp(`a bare \`${word}\` is no longer an implicit ${word}`));
        }
    });
});
