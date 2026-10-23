import { describe, expect, it } from 'vitest';
import { queryDefault } from '../src/query-default.js';
import { ownedArray } from '../src/array-storage.js';
import { isSingleCodePoint, textMatchPositions } from '../src/text-search.js';
import { findValue } from '../src/modules/sequence-search.js';
import { Interpreter, formatValue, type RankArray } from '../src/index.js';
import { InterruptedError, withInterrupt, type InterruptSignal } from '../src/interrupt.js';
import { run } from './support.js';

describe('text search', () => {
    it('uses code-point positions for first and all matches', () => {
        expect([...textMatchPositions('😀a😀a', 'a')]).toEqual([1n, 3n]);
        expect(run('use sequences\n"😀a😀a" find "😀"')).toBe('0');
        expect(run('use sequences\n"😀a😀a" findall "a"')).toBe('1 3');
    });

    it('preserves missing, empty and non-text target behavior', () => {
        expect(() => run('use sequences\n"abc" find "z"')).toThrow('find found no matching value');
        expect(run('use sequences\n"abc" findall "z"')).toBe('');
        expect(run('use sequences\n"abc" find "" default -1')).toBe('-1');
        expect(run('use sequences\n"" findall ""')).toBe('');
        expect(run('use sequences\n"123" find 1 default -1')).toBe('-1');
    });

    it('keeps array targets as whole-element equality', () => {
        expect(run('use sequences\n(array "ab" "abc") find "ab"')).toBe('0');
        expect(run('use sequences\n(array "ab" "abc") findall "b"')).toBe('');
    });

    it('shares the ordinary path for queries that a character index cannot answer', () => {
        expect(queryDefault('find', 'abc', ownedArray(['a', 'bc']))).toBeUndefined();
        expect(queryDefault('find', 'abc', ownedArray(['']))).toBeUndefined();
        expect(queryDefault('find', '😀a', ownedArray(['😀', 'a']))).toBeDefined();
        expect(run('use sequences\n"abc" find (array "a" "bc") default -1')).toBe('0 1');
    });

    it('recognizes one code point without confusing it with one UTF-16 unit', () => {
        expect(['', 'a', '😀', 'ab', 'é'].map(isSingleCodePoint)).toEqual([false, true, true, false, false]);
    });
});


describe('substring search', () => {
    it.each([false, true])('finds substrings and overlaps with compilation=%s', compilation => {
        const runtime = new Interpreter(() => {}, { compilation });
        const search = (code: string) => formatValue(runtime.execute('use sequences\n' + code)!);
        try {
            expect(search('"0110110110" find "011"')).toBe('0');
            expect(search('"0110110110" findall "011"')).toBe('0 3 6');
            expect(search('"aaaa" findall "aa"')).toBe('0 1 2');
            expect(search('"😀a😀a" findall "😀a"')).toBe('0 2');
            expect(search('"😀éé" find "é"')).toBe('1');
            expect(search('"é" find "é" default -1')).toBe('-1');
            expect(search('"ab" findall "abc"')).toBe('');
            expect(search('"" find "abc" default -1')).toBe('-1');
            expect(search('"abc" findall ""')).toBe('');
            expect(search('"abc" find "bc" default (1 // 0)')).toBe('1');
        } finally { runtime.dispose(); }
    });

    it('preserves shaped target frames, explicit ranks and per-target defaults', () => {
        const runtime = new Interpreter();
        try {
            const result = runtime.execute('use sequences\nQ = (array "ab" "bc" "z" "") reshape 2 2\n"abcabc" find Q default -1') as RankArray;
            expect(result.shape).toEqual([2, 2]);
            expect(formatValue(result)).toBe('0 1 -1 -1');
            expect(formatValue(runtime.execute('"abcabc" find (array "ab" "bc") rank 1 0')!)).toBe('0 1');
            expect(formatValue(runtime.execute('"abcabc" findall (array "ab" "bc")')!)).toBe('0 3 1 4');
            expect((runtime.execute('("abcabc" findall (array "ab" "bc")) shape') as RankArray).items).toEqual([2n, 2n]);
            expect(() => formatValue(runtime.execute('"aaaa" findall (array "aa" "aaa")')!)).toThrow(/same shape/);
            expect(() => formatValue(runtime.execute('"abc" find (array "bc" "z")')!)).toThrow('find found no matching value');
        } finally { runtime.dispose(); }
    });

    it('matches a code-point oracle, including surrogate boundaries and repeated prefixes', () => {
        const oracle = (source: string, target: string) => {
            const text = [...source], pattern = [...target], positions: bigint[] = [];
            if (pattern.length) for (let i = 0; i <= text.length - pattern.length; i++) {
                if (pattern.every((point, j) => point === text[i + j])) positions.push(BigInt(i));
            }
            return positions;
        };
        const alphabet = ['a', 'b', '😀', 'e', '́', '\ud83d', '\ude00'];
        let seed = 12345;
        const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
        for (let trial = 0; trial < 200; trial++) {
            const source = Array.from({ length: random(40) }, () => alphabet[random(alphabet.length)]).join('');
            const target = trial % 2 ? source.slice(random(source.length + 1), random(source.length + 1))
                : Array.from({ length: random(8) }, () => alphabet[random(alphabet.length)]).join('');
            expect([...textMatchPositions(source, target)]).toEqual(oracle(source, target));
        }
        expect([...textMatchPositions('😀', '\ud83d')]).toEqual([]);
        expect([...textMatchPositions('a'.repeat(50000) + 'b', 'a'.repeat(10000) + 'b')]).toEqual([40000n]);
    });

    it('polls during pattern preparation and source scanning while allowing early matches', () => {
        const cancel = (source: string, target: string) => {
            let polls = 0;
            const signal: InterruptSignal = { length: 1, load: () => 0, store() {}, wait() {},
                exchange: () => ++polls >= 2 ? 1 : 0 };
            expect(() => withInterrupt(signal, () => [...textMatchPositions(source, target)])).toThrow(InterruptedError);
            expect(polls).toBe(2);
        };
        cancel('a'.repeat(10000), 'ab');
        cancel('a', 'a'.repeat(10000));
        expect(findValue('ab' + 'x'.repeat(10000), 'ab')).toBe(0n);
        expect([...textMatchPositions('abcabc', 'bc')]).toEqual([1n, 4n]);
    });
});
