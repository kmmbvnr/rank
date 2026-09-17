import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

describe('clearing a failed source line', () => {
    it('removes the error as soon as the last character is erased', async () => {
        const repl = new NotebookRepl(createReplSession());
        const keys = new KeyRouter(repl);
        repl.notebook.replace('Missing');
        await keys.press('', { name: 'return' });
        expect(repl.notebook.current.status).toBe('error');

        for (let index = 0; index < 'Missing'.length; index++)
            await keys.press('', { name: 'backspace' });

        expect(repl.notebook.current.source).toBe('');
        expect(repl.notebook.current.status).toBe('idle');
        expect(repl.notebook.current.output).toEqual([]);
        expect(repl.notebook.current.errorOffset).toBeUndefined();
        expect(repl.notebook.cells).toHaveLength(2);
    });

    it('clears an error from a whitespace-only cell', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('Missing');
        await new KeyRouter(repl).press('', { name: 'return' });
        repl.notebook.replace('   ');

        expect(repl.notebook.current.status).toBe('idle');
        expect(repl.notebook.current.output).toEqual([]);
    });
});
