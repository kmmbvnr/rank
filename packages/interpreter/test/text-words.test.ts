import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('text words and vocabulary', () => {
    it('splits Unicode words and folds case', () => {
        expect(run('use text\n"FIRE, Пожар! fire-42" words'))
            .toBe('fire пожар fire 42');
    });

    it('orders vocabulary by frequency then codepoint and applies the limit', () => {
        expect(run('use text\n(array "Fire, rain" "rain fire snow") 2 vocab'))
            .toBe('fire rain');
        expect(run('use text\n(array "b a") 2 vocab')).toBe('a b');
        expect(run('use text\n(array "𐐀 豈") 2 vocab')).toBe('豈 𐐨');
        expect(run('use text\n(array "a") 0 vocab')).toBe('');
    });

    it('validates text and limit types', () => {
        expect(() => run('use text\n1 words')).toThrowError('words expects text');
        expect(() => run('use text\n(array "a" 1) 2 vocab'))
            .toThrowError('vocab expects text elements');
        expect(() => run('use text\n(array "a") (-1) vocab'))
            .toThrowError('vocab limit must be a nonnegative integer');
    });
});
