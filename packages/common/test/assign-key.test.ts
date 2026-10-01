import { describe, expect, it } from 'vitest';
import { Notebook } from '../src/notebook.js';

function typeInto(source: string, keys: string, cursor = source.length): Notebook {
    const book = new Notebook();
    book.replace(source, cursor);
    for (const key of keys) book.insert(key, true);
    return book;
}

describe('the typed assign key', () => {
    it('spaces the assignment as it is typed', () => {
        const book = typeInto('', 'Total,5');

        expect(book.current.source).toBe('Total = 5');
        expect(book.cursor).toBe('Total = 5'.length);
    });

    it('leaves the cursor past a single space', () => {
        const book = typeInto('Total ', ',');

        expect(book.current.source).toBe('Total = ');
        expect(book.cursor).toBe('Total = '.length);
    });

    it('joins a compound operator instead of spacing it apart', () => {
        expect(typeInto('Count +', ',').current.source).toBe('Count += ');
        expect(typeInto('Flag and', ',').current.source).toBe('Flag and= ');
    });

    it('reuses the space already after the cursor', () => {
        const book = typeInto('Total 5', ',', 'Total'.length);

        expect(book.current.source).toBe('Total = 5');
        expect(book.cursor).toBe('Total ='.length);
    });

    it('stays a comma inside a text literal or a comment', () => {
        expect(typeInto('Name = "a', ',').current.source).toBe('Name = "a,');
        expect(typeInto('rem hello', ',').current.source).toBe('rem hello,');
    });

    it('replaces the selection before rewriting the line', () => {
        const book = new Notebook();
        book.replace('Total 5');
        book.selectTo(0, 'Total '.length);
        book.selectTo(0, 'Total 5'.length, true);
        book.insert(',', true);

        expect(book.current.source).toBe('Total = ');
    });

    it('replaces double comma at line start with rem and starts voice comment', () => {
        let voiced = 0;
        const book = new Notebook();
        book.onVoiceComment = () => { voiced += 1; };

        book.insert(',', true);
        expect(book.current.source).toBe('= ');
        expect(voiced).toBe(0);

        book.insert(',', true);
        expect(book.current.source).toBe('rem ');
        expect(book.cursor).toBe('rem '.length);
        expect(voiced).toBe(1);
    });

    it('preserves indentation when replacing double comma with rem', () => {
        let voiced = 0;
        const book = new Notebook();
        book.replace('  ', 2);
        book.onVoiceComment = () => { voiced += 1; };

        book.insert(',', true);
        expect(book.current.source).toBe('  = ');
        expect(voiced).toBe(0);

        book.insert(',', true);
        expect(book.current.source).toBe('  rem ');
        expect(book.cursor).toBe('  rem '.length);
        expect(voiced).toBe(1);
    });

    it('handles direct ,, input at line start and triggers voice comment', () => {
        let voiced = 0;
        const book = new Notebook();
        book.onVoiceComment = () => { voiced += 1; };

        book.insert(',,', true);
        expect(book.current.source).toBe('rem ');
        expect(book.cursor).toBe('rem '.length);
        expect(voiced).toBe(1);
    });

    it('does not turn double comma into rem after an expression', () => {
        let voiced = 0;
        const book = typeInto('Total', ',,');
        book.onVoiceComment = () => { voiced += 1; };

        expect(book.current.source).toBe('Total = = ');
        expect(voiced).toBe(0);
    });

    it('leaves double comma as literal commas inside comments and strings', () => {
        let voiced = 0;
        const commentBook = new Notebook();
        commentBook.replace('rem hello', 'rem hello'.length);
        commentBook.onVoiceComment = () => { voiced += 1; };
        commentBook.insert(',', true);
        commentBook.insert(',', true);

        expect(commentBook.current.source).toBe('rem hello,,');
        expect(voiced).toBe(0);

        const stringBook = new Notebook();
        stringBook.replace('Name = "a', 'Name = "a'.length);
        stringBook.onVoiceComment = () => { voiced += 1; };
        stringBook.insert(',', true);
        stringBook.insert(',', true);

        expect(stringBook.current.source).toBe('Name = "a,,');
        expect(voiced).toBe(0);
    });
});
