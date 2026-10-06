import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('a lowercase name before an assignment', () => {
    it('says that variable names start with a capital letter', () => {
        expect(() => run('data = 0')).toThrow(/operation pipeline/);
        expect(() => run('for\n  count += 1\nend')).toThrow(/write `Count` instead of `count`/);
    });

    it('keeps the plain message for other unexpected tokens', () => {
        expect(() => run('X = 1 +* 2')).not.toThrow(/capital letter/);
    });
});

describe('the retired implicit index write', () => {
    it('points at new index', () => {
        expect(() => run('use algo\nindex 1 = 2')).toThrow(/a bare `index` is no longer an implicit index: create one with `Cache = new index`/);
    });
});
