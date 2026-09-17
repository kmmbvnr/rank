import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

describe('Ctrl-R on a later instruction', () => {
    it('runs restored pending instructions through the selected one', async () => {
        const repl = new NotebookRepl(createReplSession());
        const keys = new KeyRouter(repl);
        for (const source of ['Count = 0', 'Count += 1', 'Count']) repl.notebook.enqueue(source);
        repl.notebook.selectTo(2, 0);

        await keys.press('', { ctrl: true, name: 'r' });

        expect(repl.notebook.cells.slice(0, 3).map(cell => cell.status)).toEqual(['ok', 'ok', 'ok']);
        expect(repl.notebook.cells[2].output.map(line => line.text)).toEqual(['1']);
    });

    it('stops at an error before the selected instruction', async () => {
        const repl = new NotebookRepl(createReplSession());
        const keys = new KeyRouter(repl);
        for (const source of ['Count = 0', 'Missing', 'Count']) repl.notebook.enqueue(source);
        repl.notebook.selectTo(2, 0);

        await keys.press('', { ctrl: true, name: 'r' });

        expect(repl.notebook.cells[0].status).toBe('ok');
        expect(repl.notebook.cells[1].status).toBe('error');
        expect(repl.notebook.cells[2].status).toBe('idle');
        expect(repl.notebook.active).toBe(1);
    });

    it('runs pending instructions earlier in the selected cell', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.enqueue('Count = 0\nCount += 1\nCount');
        repl.notebook.selectTo(0, 'Count = 0\nCount += 1\n'.length);

        await new KeyRouter(repl).press('', { ctrl: true, name: 'r' });

        expect(repl.notebook.cells[0].output.map(line => line.text)).toEqual(['1']);
        expect(repl.notebook.cells[0].executed).toBe(repl.notebook.cells[0].source);
    });

    it('does not repeat instructions that already ran', async () => {
        const repl = new NotebookRepl(createReplSession());
        const keys = new KeyRouter(repl);
        for (const source of ['Count = 0', 'Count += 1', 'Count']) repl.notebook.enqueue(source);
        repl.notebook.selectTo(0, 0);
        await keys.press('', { ctrl: true, name: 'r' });
        repl.notebook.selectTo(2, 0);

        await keys.press('', { ctrl: true, name: 'r' });

        expect(repl.notebook.cells[2].output.map(line => line.text)).toEqual(['1']);
    });
});
