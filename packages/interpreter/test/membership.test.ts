import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { run } from './support.js';
import { MissingValueError } from '../src/errors.js';
import { STREAM_CELLS } from '../src/array-storage.js';

describe('collection membership', () => {
    it('tests every left cell against the whole right collection', () => {
        expect(run('use sequences\n(array 1 2 3 4 17 18) in primes'))
            .toBe('false true true false true false');
        expect(run('(array 1 2 3 4) in (array 4 2)')).toBe('false true false true');
        expect(run('(array "Ann" "Bob" "Ann") in (array "Bob" "Eve")'))
            .toBe('false true false');
        expect(run('(array 2 3) in (array 2.0)')).toBe('true false');
        expect(run('(array 2 3) not in (array 2.0)')).toBe('false true');
    });

    it('uses the resulting mask for selection and boolean composition', () => {
        expect(run('use sequences\nA = array 1 2 3 4 5\nA (A in primes)'))
            .toBe('2 3 5');
        expect(run('use sequences\nA = array 1 2 3 4 5\n(A in primes) and (A greater 2)'))
            .toBe('false false true false true');
        expect(run('use sequences\nA = 1 to 5\nA (A in primes)'))
            .toBe('2 3 5');
    });

    it('preserves tensor and empty shapes', () => {
        const value = new Interpreter().execute(`use sequences
A = array shape 2 3
  1 2 3 4 5 6
end
A in primes`);
        expect(value && isRankArray(value) && value.shape).toEqual([2, 3]);
        expect(value && isRankArray(value) && value.items).toEqual([false, true, true, false, true, false]);
        const empty = new Interpreter().execute('A = array shape 0 3\nend\nA in (array 1 2)');
        expect(empty && isRankArray(empty) && empty.shape).toEqual([0, 3]);
        expect(run('Empty = array shape 0\nend\n(array 1 2) in Empty')).toBe('false false');
    });

    it('uses existing keyed collections and keeps text atomic', () => {
        expect(run('use algo\nS = new set\nS add 2\nS add 5\n(array 1 2 5) in S'))
            .toBe('false true true');
        expect(run('(array "ab" "z" "") in "abc"')).toBe('true false true');
        expect(run('"ab" in "abc"')).toBe('true');
    });

    it('supports queue inputs, indexes and multisets', () => {
        expect(run('use algo\nQ = new queue\nQ push 2\nQ push 3\nQ in (array 3)'))
            .toBe('false true');
        expect(run('use algo\nQ = new queue\nQ push 3\n(array 2 3) in Q'))
            .toBe('false true');
        expect(run('use algo\nI = new index\nI 3 = 9\n(array 2 3) in I'))
            .toBe('false true');
        expect(run('use algo\nBag = (array 3 3) multiset\n(array 2 3) in Bag'))
            .toBe('false true');
    });

    it('retains exact numeric equality in the scalar lookup', () => {
        const runtime = new Interpreter();
        runtime.variables.set('Allowed', {
            kind: 'array', shape: [4], items: [NaN, -0, 9007199254740992, Infinity],
        });
        runtime.variables.set('Queries', {
            kind: 'array', shape: [5], items: [NaN, 0n, 9007199254740992n, 9007199254740993n, Infinity],
        });
        const mask = runtime.execute('Queries in Allowed');
        expect(mask && isRankArray(mask) && mask.items).toEqual([false, true, true, false, true]);
    });

    it('maps sequences to booleans without zipping or filtering', () => {
        expect(run('use sequences\n(1 to 5) in primes')).toBe('false true true false true');
        expect(run('(1 to 5) in (2 to 3)')).toBe('false true true false false');
        expect(run('(1 to 3) not in (array 2)')).toBe('true false true');
        expect(run('use sequences\nMask = primes in (array 2 5)\narray (Mask 0) (Mask 1) (Mask 2) (Mask 3)')).toBe('true false true false');
    });

    it('supports fibonacci membership and retains source boundaries', () => {
        expect(run('use sequences\n(array 0 1 2 4 8 13 14) in fibonacci'))
            .toBe('false true true false true true false');
        expect(run('use sequences\n(array 2 8 13 21) in (fibonacci from 8 till 21)'))
            .toBe('false true true false');
        expect(run('use sequences\n(array 2 11 23) in (primes from 10 till 20)'))
            .toBe('false true false');
    });

    it('indexes a finite right sequence only once for the whole mask', () => {
        const runtime = new Interpreter();
        let reads = 0;
        runtime.variables.set('Allowed', {
            kind: 'sequence',
            plan: {
                name: 'counted source',
                size: { kind: 'exact', value: 3n },
                *iterate() {
                    for (const value of [2n, 4n, 6n]) {
                        reads += 1;
                        yield value;
                    }
                },
            },
        });
        const mask = runtime.execute('(array 1 2 3 4 5 6) in Allowed');
        expect(mask && isRankArray(mask) && mask.items).toEqual([false, true, false, true, false, true]);
        expect(reads).toBe(3);
    });

    it.each([false, true])('negates a tensor mask in one pass without changing input effects (compiled=%s)', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        const events: string[] = [];
        try {
            runtime.variables.set('Allowed', { kind: 'sequence', plan: {
                name: 'single pass', singlePass: true, size: { kind: 'unknown' },
                *iterate() { events.push('right'); yield 2n; },
            } });
            runtime.variables.set('Queries', { kind: 'array', shape: [2, 2], items: [],
                itemAt: index => { events.push(`left ${index}`); return BigInt(index + 1); } });
            const mask = runtime.execute('Mask = Queries not in Allowed\nMask');
            expect(mask && isRankArray(mask) && mask.shape).toEqual([2, 2]);
            expect(mask && isRankArray(mask) && mask.items).toEqual([true, false, true, true]);
            expect(events).toEqual(['right', 'left 0', 'left 1', 'left 2', 'left 3']);
            runtime.execute('Mask 0 0 = false');
            expect(mask && isRankArray(mask) && mask.items).toEqual([false, false, true, true]);
            expect(events).toHaveLength(5);
            const empty = runtime.execute('Empty = array shape 0 3 fill 0\nEmpty not in (array 2)');
            expect(empty && isRankArray(empty) && empty.shape).toEqual([0, 3]);
        } finally { runtime.dispose(); }
    });

    it('keeps structural equality for record elements', () => {
        expect(run('A = record\n .x = 1\nend\nB = record\n .x = 1.0\nend\n(array A) in (array B)'))
            .toBe('true');
    });

    it.each([false, true])('reads a right array once, before queries, on every operation (compiled=%s)', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        const events: string[] = [];
        let allowed = 2n;
        try {
            runtime.variables.set('Allowed', { kind: 'array', shape: [2], items: [],
                itemAt: index => { events.push(`right ${index}`); return allowed + BigInt(index); } });
            runtime.variables.set('Queries', { kind: 'array', shape: [2], items: [],
                itemAt: index => { events.push(`left ${index}`); return BigInt(index + 1); } });
            for (const expected of [[false, true], [true, true]]) {
                events.length = 0;
                const mask = runtime.execute('Queries in Allowed');
                expect(mask && isRankArray(mask) && mask.items).toEqual(expected);
                expect(events).toEqual(['right 0', 'right 1', 'left 0', 'left 1']);
                allowed = 1n;
            }
        } finally { runtime.dispose(); }
    });

    it.each([false, true])('preserves right array failures before reading queries (soft=%s)', soft => {
        const runtime = new Interpreter();
        const events: string[] = [];
        try {
            runtime.variables.set('Allowed', { kind: 'array', shape: [2], items: [], itemAt: index => {
                events.push(`right ${index}`);
                if (index === 1) throw new MissingValueError('unavailable cell', soft);
                return 1n;
            } });
            runtime.variables.set('Queries', { kind: 'array', shape: [1], items: [],
                itemAt: () => { events.push('left'); return 1n; } });
            expect(() => runtime.execute('Queries in Allowed')).toThrow('unavailable cell');
            expect(events).toEqual(['right 0', 'right 1']);
        } finally { runtime.dispose(); }
    });

    it('keeps streaming large right arrays, tolerating soft misses and stopping at hard failures', () => {
        const runtime = new Interpreter();
        const events: number[] = [];
        try {
            runtime.variables.set('Allowed', { kind: 'array', shape: [STREAM_CELLS], items: [],
                itemAt: () => { throw new Error('must use the streaming reader'); },
                streamAt: index => {
                    events.push(index);
                    if (index === 0) throw new MissingValueError('absent cell', true);
                    if (index === 1) return 2n;
                    throw new MissingValueError('failed cell');
                } });
            expect(() => runtime.execute('(array 1 2) in Allowed')).toThrow('failed cell');
            expect(events).toEqual([0, 1, 2]);
        } finally { runtime.dispose(); }
    });
});
