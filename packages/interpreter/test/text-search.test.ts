import { describe, expect, it } from 'vitest';
import { queryDefault } from '../src/query-default.js';
import { ownedArray } from '../src/array-storage.js';
import { isSingleCodePoint, textMatchPositions } from '../src/text-search.js';
import { run } from './support.js';

describe('text search', () => {
    it('uses code-point positions for first and all matches', () => {
        expect([...textMatchPositions('😀a😀a', 'a')]).toEqual([1n, 3n]);
        expect(run('use sequences\n"😀a😀a" "😀" find')).toBe('0');
        expect(run('use sequences\n"😀a😀a" "a" findall')).toBe('1 3');
    });

    it('preserves missing, empty and non-text target behavior', () => {
        expect(() => run('use sequences\n"abc" "z" find')).toThrow('find found no matching value');
        expect(run('use sequences\n"abc" "z" findall')).toBe('');
        expect(run('use sequences\n"abc" "" find default -1')).toBe('-1');
        expect(run('use sequences\n"" "" findall')).toBe('');
        expect(run('use sequences\n"123" 1 find default -1')).toBe('-1');
    });

    it('keeps array targets as whole-element equality', () => {
        expect(run('use sequences\n(array "ab" "abc") "ab" find')).toBe('0');
        expect(run('use sequences\n(array "ab" "abc") "b" findall')).toBe('');
    });

    it('shares the ordinary path for queries that a character index cannot answer', () => {
        expect(queryDefault('find', 'abc', ownedArray(['a', 'bc']))).toBeUndefined();
        expect(queryDefault('find', 'abc', ownedArray(['']))).toBeUndefined();
        expect(queryDefault('find', '😀a', ownedArray(['😀', 'a']))).toBeDefined();
        expect(run('use sequences\n"abc" (array "a" "bc") find default -1')).toBe('0 -1');
    });

    it('recognizes one code point without confusing it with one UTF-16 unit', () => {
        expect(['', 'a', '😀', 'ab', 'é'].map(isSingleCodePoint)).toEqual([false, true, true, false, false]);
    });
});
