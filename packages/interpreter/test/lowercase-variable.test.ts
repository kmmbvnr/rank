import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('a lowercase name before an assignment', () => {
    it('says that variable names start with a capital letter', () => {
        expect(() => run('i = 0')).toThrow(/variable names start with a capital letter, write `I` instead of `i`/);
        expect(() => run('for\n  count += 1\nend')).toThrow(/write `Count` instead of `count`/);
    });

    it('keeps the plain message for other unexpected tokens', () => {
        expect(() => run('X = 1 +* 2')).not.toThrow(/capital letter/);
    });
});
