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
        // The emptied cell folds into the empty prompt below it.
        expect(repl.notebook.atPrompt).toBe(true);
        expect(repl.notebook.cells).toHaveLength(1);
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

describe('running a line after a failed one', () => {
    it('does not carry a syntax error over to the corrected line', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('X = @');
        await repl.submit(true);
        expect(repl.notebook.cells[0]!.status).toBe('error');
        expect(repl.notebook.cells[0]!.output[0]!.text).not.toMatch(/Expecting|Token sequences|<\[NL\]>/);

        repl.notebook.replace('X = 1 + 2');
        await repl.submit(true);
        expect(repl.notebook.cells.some(cell => cell.status === 'error')).toBe(false);
        expect(repl.notebook.cells.flatMap(cell => cell.output.map(line => line.text))).toEqual(['3']);
    });

    it('opens a block on Play for a function header instead of reporting an error', async () => {
        const repl = new NotebookRepl(createReplSession());
        repl.notebook.replace('fun inc N');
        await repl.submit(true);
        expect(repl.notebook.cells.some(cell => cell.status === 'error')).toBe(false);
    });
});
