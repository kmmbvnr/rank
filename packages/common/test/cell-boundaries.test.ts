import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { Notebook, splitSource } from '../src/notebook.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { notebookFrame } from '../src/screen.js';

function labels(book: Notebook): string[] {
    const frame = notebookFrame(book, 80, 30, 0, '', false, true, '', 'Running…',
        undefined, 'rank> ', undefined, undefined, undefined, false, undefined, true, 0);
    return frame.lines.flatMap(line => /^(?:\x1b\[\d+m)?●\s*(\d+)›/.exec(line)?.[1] ?? []);
}

const sources = (book: Notebook) => book.cells.slice(0, -1).map(cell => cell.source);

describe('cell boundaries follow content', () => {
    it('joins consecutive use lines into one cell, from a file or from typing', () => {
        expect(splitSource('use sequences\nuse text\nX = 1\nuse io')).toEqual(['use sequences\nuse text', 'X = 1', 'use io']);
        const typed = new Notebook();
        typed.enqueue('use sequences');
        typed.enqueue('use numbers');
        expect(sources(typed)).toEqual(['use sequences\nuse numbers']);
    });

    it('splits a cell edited into several statements when the cursor leaves it', () => {
        const book = new Notebook();
        book.enqueue('use sequences');
        book.enqueue('Y = 2');
        book.selectTo(0, 'use sequences'.length);
        book.insert('\nX = 1');
        expect(sources(book)).toEqual(['use sequences\nX = 1', 'Y = 2']);

        book.selectTo(1, 0);
        expect(sources(book)).toEqual(['use sequences', 'X = 1', 'Y = 2']);
        expect(book.active).toBe(2);
    });

    it('keeps the cursor with its statement and the saved file unchanged', () => {
        const book = new Notebook();
        book.enqueue('A = 1\nB = 2\n\nC = 3');
        const saved = book.fileLines();
        book.selectTo(0, 'A = 1\nB'.length);
        book.toPrompt();
        expect(sources(book)).toEqual(['A = 1', 'B = 2', '', 'C = 3']);
        expect(book.fileLines()).toEqual(saved);
    });

    it('carries execution state over to the statements that did not change', async () => {
        const repl = new NotebookRepl(createReplSession());
        const keys = new KeyRouter(repl);
        repl.notebook.replace('X = 1 + 1');
        await keys.press('', { name: 'return' });
        const book = repl.notebook;
        book.selectTo(0, 'X = 1 + 1'.length);
        book.insert('\nY = X');
        book.toPrompt();

        expect(sources(book)).toEqual(['X = 1 + 1', 'Y = X']);
        expect(book.cells[0].executed).toBe('X = 1 + 1');
        expect(book.cells[0].status).toBe('ok');
        expect(book.cells[1].executed).toBeUndefined();
        expect(book.dirtyFrom).toBe(1);
    });

    it('splits cells saved by an earlier session the same way', () => {
        const book = new Notebook();
        book.restore('use sequences\nX = 1');
        book.restore('');
        book.restore('Y = X');
        expect(sources(book)).toEqual(['use sequences', 'X = 1', '', 'Y = X']);
    });
});

describe('numbering', () => {
    it('skips blank and comment-only cells without gaps', () => {
        const book = new Notebook();
        for (const source of ['use sequences', '', 'rem note', 'Fib = 1']) book.enqueue(source);
        expect(labels(book)).toEqual(['1', '2']);
    });

    it('gives a comment no status and clears an executed cell edited into one', async () => {
        const repl = new NotebookRepl(createReplSession());
        const keys = new KeyRouter(repl);
        repl.notebook.replace('1 + 1');
        await keys.press('', { name: 'return' });
        const cell = repl.notebook.cells[0];
        expect(cell.status).toBe('ok');
        expect(cell.output).not.toHaveLength(0);

        repl.notebook.selectTo(0, 0);
        repl.notebook.insert('rem ');
        expect(cell.source).toBe('rem 1 + 1');
        expect(cell.output).toEqual([]);
        expect(cell.status).toBe('idle');
        expect(labels(repl.notebook)).toEqual([]);

        repl.notebook.toPrompt();
        await keys.press('', { ctrl: true, name: 'l' });
        expect(cell.status).toBe('idle');
        expect(cell.output).toEqual([]);
    });
});
