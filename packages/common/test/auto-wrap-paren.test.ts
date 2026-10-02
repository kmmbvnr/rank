import { describe, expect, it } from 'vitest';
import { Notebook } from '../src/notebook.js';

function typeInto(source: string, keys: string, cursor = source.length): Notebook {
    const book = new Notebook();
    book.replace(source, cursor);
    for (const key of keys) book.insert(key, true);
    return book;
}

describe('an unmatched closing bracket', () => {
    it('wraps the binary operation before it', () => {
        expect(typeInto('A i i+1', ')').current.source).toBe('A i (i+1)');
        expect(typeInto('Total + Count * Factor', ')').current.source).toBe('Total + (Count * Factor)');
        expect(typeInto('Base + Offset', ')').current.source).toBe('(Base + Offset)');
    });

    it('leaves the cursor after the new bracket', () => {
        const book = typeInto('Base + Offset', ')');

        expect(book.cursor).toBe('(Base + Offset)'.length);
    });

    it('wraps only what stands before the cursor', () => {
        const book = typeInto('A + B tail', ')', 'A + B'.length);

        expect(book.current.source).toBe('(A + B) tail');
    });

    it('is typed as it is when nothing can be wrapped', () => {
        expect(typeInto('Values', ')').current.source).toBe('Values)');
        expect(typeInto('X = -1', ')').current.source).toBe('X = -1)');
        expect(typeInto('Values filter Positive', ')').current.source).toBe('Values filter Positive)');
    });

    it('is typed as it is inside text, a comment or an existing bracket', () => {
        expect(typeInto('Say "a + b', ')').current.source).toBe('Say "a + b)');
        expect(typeInto('rem a + b', ')').current.source).toBe('rem a + b)');
        expect(typeInto('(A + B', ')').current.source).toBe('(A + B)');
        expect(typeInto('(A) + B * C', ')').current.source).toBe('(A) + B * C)');
    });

    it('does not wrap a pasted bracket', () => {
        const book = new Notebook();
        book.insert('A + B)');

        expect(book.current.source).toBe('A + B)');
    });
});
