import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

describe('Enter in an earlier error cell', () => {
    it('keeps the failed cell active through repeated Enter presses', async () => {
        const repl = new NotebookRepl(createReplSession());
        const keys = new KeyRouter(repl);
        repl.notebook.replace('sadsadafsdfddsds');

        await keys.press('', { name: 'return' });
        expect(repl.notebook.cells[0].status).toBe('error');
        expect(repl.notebook.active).toBe(0);
        for (let count = 0; count < 3; count++) await keys.press('', { name: 'return' });

        expect(repl.notebook.cells).toHaveLength(2);
        expect(repl.notebook.active).toBe(0);
    });

    it('inserts a line without copying the failed statement into a new cell', async () => {
        const session = createReplSession();
        const repl = new NotebookRepl(session);
        repl.notebook.enqueue('Value = Missing');
        repl.notebook.cells[0].status = 'error';
        repl.notebook.selectTo(0, 0);

        await new KeyRouter(repl).press('', { name: 'return' });

        expect(repl.notebook.cells).toHaveLength(2);
        expect(repl.notebook.cells[0].source).toBe('\nValue = Missing');
        expect(repl.notebook.active).toBe(0);
    });
});
