import { describe, expect, it } from 'vitest';
import { RankSegment } from '../src/segment.js';
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
});
