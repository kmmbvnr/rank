import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { importPosition, missingImports } from '../src/import-fix.js';
import { Notebook } from '../src/notebook.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { fixAt, notebookFrame } from '../src/screen.js';

function frame(repl: NotebookRepl) {
    return notebookFrame(repl.notebook, 80, 20, 0, repl.suggestion, false, true, '', 'Running…',
        undefined, 'rank> ', undefined, undefined, undefined, false, undefined, true, 0,
        undefined, repl.importFixFocus);
}

async function failAtPrompt(cells: string[], failing: string) {
    const repl = new NotebookRepl(createReplSession());
    const keys = new KeyRouter(repl);
    for (const source of cells) {
        repl.notebook.replace(source);
        await keys.press('', { name: 'return' });
    }
    repl.notebook.replace(failing);
    await keys.press('', { name: 'return' });
    return { repl, keys };
}

describe('import suggestions', () => {
    it('reads the suggested modules from an error', () => {
        const output = [{ text: 'unknown name: example; did you forget `use graph` or `use sequences`?', error: true }];
        expect(missingImports(output)).toEqual(['graph', 'sequences']);
        expect(missingImports([{ text: 'unknown name: Value', error: true }])).toEqual([]);
    });

    it('keeps imports sorted and never lands below the failing cell', () => {
        const book = new Notebook();
        for (const source of ['rem Header', 'use io', 'use sequences', 'X = 1', 'Y = X round']) book.enqueue(source);
        expect(book.cells.map(cell => cell.source)).toEqual(['rem Header', 'use io\nuse sequences', 'X = 1', 'Y = X round', '']);
        expect(importPosition(book.cells, 'numbers', 3)).toEqual({ index: 1, line: 1 });
        expect(importPosition(book.cells, 'algo', 3)).toEqual({ index: 1, line: 0 });
        expect(importPosition(book.cells, 'text', 3)).toEqual({ index: 1, line: 2 });
        expect(importPosition(book.cells, 'numbers', 1)).toEqual({ index: 1 });
    });

    it('puts the first import after the leading comments', () => {
        const book = new Notebook();
        for (const source of ['rem Header\nrem More', 'X = 1', 'Y = X round']) book.enqueue(source);
        expect(importPosition(book.cells, 'numbers', 2)).toEqual({ index: 1 });
    });

    it('places a keyboard import after the comments and among the imports, with the prompt as the limit', () => {
        const book = new Notebook();
        for (const source of ['rem Header', 'rem More', 'X = 1']) book.enqueue(source);
        const prompt = book.cells.length - 1;
        expect(importPosition(book.cells, 'graph', prompt)).toEqual({ index: 2 });
        const imported = new Notebook();
        for (const source of ['rem Header', 'use graph', 'X = 1']) imported.enqueue(source);
        expect(importPosition(imported.cells, 'sequences', imported.cells.length - 1)).toEqual({ index: 1, line: 1 });
        expect(importPosition(imported.cells, 'algo', imported.cells.length - 1)).toEqual({ index: 1, line: 0 });
    });

    it('underlines the suggestion and inverts it when focused', async () => {
        const { repl, keys } = await failAtPrompt([], 'X = 4.0 sqrt');
        const plain = frame(repl);
        const row = plain.lines.findIndex(line => line.includes('\x1b[4muse numbers\x1b[24m'));
        expect(row).toBeGreaterThan(0);
        expect(plain.lines.join('\n')).not.toContain('`');
        const target = plain.targets![row];
        expect(target?.kind).toBe('autofix');
        const column = target!.fixes![0].from;
        expect(fixAt(target, column)?.module).toBe('numbers');
        expect(fixAt(target, column - 1)).toBeUndefined();

        await keys.press('', { name: 'down' });
        expect(repl.importFixFocus).toBe(0);
        const focused = frame(repl);
        expect(focused.lines[row]).toContain('\x1b[7muse numbers\x1b[27m');
        expect(focused.cursor).toEqual({ row, column });

        await keys.press('', { name: 'up' });
        expect(repl.importFixFocus).toBeUndefined();
        expect(repl.notebook.cells).toHaveLength(2);
    });

    it('inserts the import in order and reruns the failed line', async () => {
        const { repl, keys } = await failAtPrompt(['use io', 'use sequences'], 'X = 4.0 sqrt');
        expect(repl.notebook.current.status).toBe('error');

        await keys.press('', { name: 'down' });
        await keys.press('', { name: 'return' });

        const book = repl.notebook;
        expect(book.cells.map(cell => cell.source)).toEqual(['use io\nuse numbers\nuse sequences', 'X = 4.0 sqrt', '']);
        expect(book.cells.slice(0, -1).map(cell => cell.status)).toEqual(['ok', 'ok']);
        expect(book.atPrompt).toBe(true);
    });

    it('suggests only sequences for collection find', async () => {
        const { repl } = await failAtPrompt([], 'X = (array 3 1 2) 1 find');
        expect(repl.importFixes).toEqual(['sequences']);
    });

    it('switches between candidate modules in a diagnostic', async () => {
        const { repl, keys } = await failAtPrompt([], 'X = (array 3 1 2) 1 find');
        // Exercise alternative navigation independently of the catalogue, whose names are unique.
        repl.notebook.current.output = [{
            text: 'unknown name: example; did you forget `use graph` or `use sequences`?', error: true,
        }];
        expect(repl.importFixes).toEqual(['graph', 'sequences']);

        await keys.press('', { name: 'down' });
        await keys.press('', { name: 'right' });
        expect(repl.importFixFocus).toBe(1);
        await keys.press('', { name: 'return' });

        expect(repl.notebook.cells[0].source).toBe('use sequences');
        expect(repl.notebook.cells[1].status).toBe('ok');
    });

    it('typing releases the focus and edits the source', async () => {
        const { repl, keys } = await failAtPrompt([], 'X = 4.0 sqrt');
        await keys.press('', { name: 'down' });
        await keys.press('1', {});
        expect(repl.importFixFocus).toBeUndefined();
        expect(repl.notebook.current.source).toBe('X = 4.0 sqrt1');
    });
});
