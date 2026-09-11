import { describe, expect, it } from 'vitest';
import { RankRangeSumSegment, RankSegment } from '../src/segment.js';
import { run } from './support.js';

describe('segment tree', () => {
    it('builds a minimum tree and supports point updates', () => {
        expect(run([
            'use algo',
            'use numbers',
            'Values = array 5 2 7 1 6',
            'Tree = Values min segment',
            'Before = Tree 1 4 query',
            'Tree 3 = 9',
            'After = Tree 1 4 query',
            'Tree 1 += 4',
            'Final = Tree 0 4 query',
            'array Before After Final (Tree 1)',
        ].join('\n'))).toBe('1 2 5 6');
    });

    it('uses symbolic operations and keeps operand order', () => {
        expect(run([
            'use algo',
            'Values = array 1 2 3 4',
            'Sums = Values + segment',
            'A = Sums 1 3 query',
            'fun merge A B',
            '  return A + B',
            'end',
            'Words = (array "a" "b" "c" "d") merge segment',
            'B = Words 1 3 query',
            'array A B',
        ].join('\n'))).toBe('9 bcd');
    });

    it('updates sum segments over inclusive ranges', () => {
        expect(run([
            'use algo',
            'Tree = (array 2 3 1 1 5 3) + segment',
            'Before = Tree 2 4 query',
            'Tree 1 3 += 2',
            'Middle = Tree 2 4 query',
            'Tree 1 3 = 5',
            'After = Tree 2 4 query',
            'Tree 0 += 3',
            'Place = Tree 16 firstatleast',
            'array Before Middle After Place',
        ].join('\n'))).toBe('7 11 15 3');
    });

    it('validates sum segment range updates', () => {
        expect(() => run([
            'use algo',
            'Tree = (array 1 2) + segment',
            'Tree 1 0 += 3',
        ].join('\n'))).toThrow(
            'segment query start must not exceed its end',
        );
        expect(() => run([
            'use algo',
            'Tree = (array 1 2) + segment',
            'Tree 0 1 = "x"',
        ].join('\n'))).toThrow(
            '+ segment expects numeric values',
        );
        expect(() => run([
            'use algo',
            'Tree = (array 1 2) + segment',
            'Tree 0 1 *= 2',
        ].join('\n'))).toThrow(
            '+ segment range assignment supports = and +=',
        );
    });

    it('copies sum segments with independent updates', () => {
        expect(run([
            'use algo',
            'use sequences',
            'First = (array 2 3 1 2 5) + segment',
            'Second = First copy',
            'First 0 = 9',
            'Second 1 = 5',
            'Third = Second copy',
            'Third 0 2 += 1',
            'Result = array shape 5',
            '  (First 0 4 query)',
            '  (Second 0 4 query)',
            '  (Third 0 4 query)',
            '  (First 1) (Second 0)',
            'end',
            'Result',
        ].join('\n'))).toBe('20 15 18 3 2');
    });

    it('honors a shadowing named operation', () => {
        expect(run([
            'use algo',
            'fun min A B',
            '  return A + B',
            'end',
            'Tree = (array 2 3 4) min segment',
            'Tree 0 2 query',
        ].join('\n'))).toBe('9');
    });

    it('continues a pipeline after construction', () => {
        expect(run([
            'use algo',
            'use numbers',
            '(array 8 3 5) min segment 0 2 query',
        ].join('\n'))).toBe('3');
    });

    it('reports bounds and invalid ranges as Rank errors', () => {
        expect(run('use algo\nTree = (array 1 2) + segment\nTree (-1) pad 7')).toBe('7');
        expect(() => run('use algo\nTree = (array 1 2) + segment\nTree 0 2 query'))
            .toThrowError('segment index out of bounds: 2');
        expect(() => run('use algo\nTree = (array 1 2) + segment\nTree 1 0 query'))
            .toThrowError('segment query start must not exceed its end');
    });

    it('has a type, length and shape and requires the algorithm module', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Tree = (array 1 2 3) + segment',
            'array (Tree type) (Tree len) (Tree shape)',
        ].join('\n'))).toBe('.segment 3 3');
        expect(() => run('(array 1 2) + segment'))
            .toThrowError('segment requires: use algo');
        expect(() => run('use algo\n(array 1 2) - segment'))
            .toThrowError('segment requires an associative operation');
    });

    it('accepts named bit operations and empty input', () => {
        expect(run([
            'use algo',
            'use bits',
            'use sequences',
            'Tree = (array 7 3 5) bxor segment',
            'Empty = (array shape 0 pad 0) + segment',
            'array (Tree 0 2 query) (Empty len)',
        ].join('\n'))).toBe('1 0');
    });

    it('finds the first prefix aggregate at least a target', () => {
        expect(run([
            'use algo',
            'use numbers',
            'Maximums = (array 2 7 3 9) max segment',
            'Counts = (array 1 0 1 1) + segment',
            'Result = array shape 5',
            '  (Maximums 1 firstatleast)',
            '  (Maximums 8 firstatleast)',
            '  (Maximums 10 firstatleast)',
            '  (Counts 2 firstatleast)',
            '  (Counts 3 firstatleast)',
            'end',
            'Result',
        ].join('\n'))).toBe('0 3 -1 2 3');
    });

    it('updates search results and validates numeric aggregates', () => {
        expect(run([
            'use algo',
            'use numbers',
            'Tree = (array 4 2 8) max segment',
            'Tree 0 = 0',
            'Tree 5 firstatleast',
        ].join('\n'))).toBe('2');
        expect(run('use algo\nEmpty = (array shape 0 pad 0) + segment\nEmpty 1 firstatleast'))
            .toBe('-1');
        expect(() => run('use algo\nTree = (array "a" "b") + segment\nTree 1 firstatleast'))
            .toThrowError('firstatleast expects numeric segment aggregates');
    });

    it('provides the numeric maxsum profile and point updates', () => {
        expect(run([
            'use algo',
            'Tree = (array -2 3 -1 4 -8) maxsum segment',
            'Before = Tree 0 4 query',
            'Tree 4 = 5',
            'After = Tree 2 4 query',
            'Result = array shape 9',
            '  (Before .sum) (Before .prefix) (Before .suffix) (Before .best)',
            '  (After .sum) (After .prefix) (After .suffix) (After .best) (Tree 4)',
            'end',
            'Result',
        ].join('\n'))).toBe('-4 4 0 6 8 8 9 9 5');
        expect(() => run('use algo\n(array 1 "x") maxsum segment'))
            .toThrowError('maxsum segment expects numeric values');
    });

    it('honors a user function that shadows maxsum', () => {
        expect(run([
            'use algo',
            'fun maxsum A B',
            '  return A + B',
            'end',
            'Tree = (array 1 2 3) maxsum segment',
            'Tree 0 2 query',
        ].join('\n'))).toBe('6');
    });

    it('matches a direct oracle across updates and ranges', () => {
        let state = 17;
        const random = (limit: number): number => {
            state = (state * 48271) % 2147483647;
            return state % limit;
        };
        const values = Array.from({ length: 37 }, () => BigInt(random(1000)));
        const tree = new RankSegment(
            values,
            (left, right) => (left as bigint) < (right as bigint) ? left : right,
            'min',
        );

        for (let step = 0; step < 500; step++) {
            if (step % 3 === 0) {
                const position = random(values.length);
                const value = BigInt(random(1000));
                values[position] = value;
                tree.set(BigInt(position), value);
                continue;
            }
            const first = random(values.length);
            const second = random(values.length);
            const left = Math.min(first, second);
            const right = Math.max(first, second);
            const expected = values.slice(left, right + 1)
                .reduce((a, b) => a < b ? a : b);
            expect(tree.query(BigInt(left), BigInt(right))).toBe(expected);
        }
    });

    it('matches a range sum oracle', () => {
        let state = 31;
        const random = (limit: number): number => {
            state = (state * 48271) % 2147483647;
            return state % limit;
        };
        const values = Array.from(
            { length: 43 }, () => BigInt(random(100)),
        );
        const tree = new RankRangeSumSegment(values);
        for (let step = 0; step < 500; step += 1) {
            const a = random(values.length);
            const b = random(values.length);
            const left = Math.min(a, b);
            const right = Math.max(a, b);
            if (step % 4 === 0) {
                const value = BigInt(random(100));
                tree.setRange(BigInt(left), BigInt(right), value);
                values.fill(value, left, right + 1);
            } else if (step % 4 === 1) {
                const value = BigInt(random(20));
                tree.addRange(BigInt(left), BigInt(right), value);
                for (let index = left; index <= right; index += 1) {
                    values[index] += value;
                }
            } else {
                const expected = values.slice(left, right + 1)
                    .reduce((sum, value) => sum + value, 0n);
                expect(tree.query(BigInt(left), BigInt(right)))
                    .toBe(expected);
            }
        }
    });
});
