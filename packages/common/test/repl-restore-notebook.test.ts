import { describe, expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

describe('notebook switching', () => {
    it('clears interpreter state, outputs and breakpoints while preserving an unfinished draft', async () => {
        const session = createReplSession();
        const repl = new NotebookRepl(session);
        repl.notebook.replace('Old = 99');
        await repl.submit();
        expect(session.names).toContain('Old');
        repl.breakpoints.set(repl.notebook.cells[0].id, new Set([1]));
        repl.help = { text: 'old help', top: 2 };
        repl.suggestion = 'old suggestion';
        await repl.restoreNotebook(['rem Saved notebook', 'Value = 7'], 'for i in ');
        expect(session.names).not.toContain('Old');
        expect(session.names).not.toContain('Value');
        expect(repl.notebook.cells.map(cell => cell.source)).toEqual(['rem Saved notebook', 'Value = 7', 'for i in ']);
        expect(repl.notebook.cells.every(cell => cell.output.length === 0)).toBe(true);
        expect(repl.notebook.cells[1].status).toBe('idle');
        expect(repl.notebook.atPrompt).toBe(true);
        expect(repl.notebook.cursor).toBe('for i in '.length);
        expect(repl.breakpoints.size).toBe(0);
        expect(repl.help).toBeUndefined();
        expect(repl.suggestion).toBe('');
        await repl.restoreNotebook([], '');
        expect(repl.notebook.cells.map(cell => cell.source)).toEqual(['']);
    });
});
