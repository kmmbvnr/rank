import { describe, expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { notebookFrame } from '../src/screen.js';

const source = ['rem Small program', 'rem A header is not execution', '', 'A = 1', 'B = A + 2', 'B * 3'];

describe('execution provenance', () => {
    it.each(['prompt', 'last instruction'])('marks the first Play green from the %s after restoring comments', async cursor => {
        const session = createReplSession();
        const repl = new NotebookRepl(session, () => {}, () => 80);
        try {
            await repl.restoreNotebook(source, '');
            if (cursor === 'last instruction') {
                const index = repl.notebook.cells.length - 2;
                repl.notebook.selectTo(index, repl.notebook.cells[index].source.length);
            }
            await repl.rerun();
            const code = repl.notebook.cells.filter(cell => cell.status === 'ok');
            expect(code.map(cell => cell.source)).toEqual(['A = 1', 'B = A + 2', 'B * 3']);
            expect(repl.notebook.cells.every((_, index) => !repl.notebook.isExperimental(index))).toBe(true);
            const frame = notebookFrame(repl.notebook, 80, 24);
            for (const row of frame.lines.filter(line => /[AB] =|B \* 3/.test(line))) {
                expect(row).toContain('\x1b[32m');
                expect(row).not.toContain('\x1b[38;5;208m');
            }
        } finally { session.dispose(); }
    });

    it('keeps an actual retained-state replay orange', async () => {
        const session = createReplSession();
        const repl = new NotebookRepl(session, () => {}, () => 80);
        try {
            await repl.restoreNotebook(source, '');
            await repl.rerun();
            const index = repl.notebook.cells.findIndex(cell => cell.source === 'B = A + 2');
            repl.notebook.selectTo(index, repl.notebook.cells[index].source.length);
            await repl.rerun();
            expect(repl.notebook.isExperimental(index - 1)).toBe(false);
            expect(repl.notebook.isExperimental(index)).toBe(true);
            await repl.restart();
            expect(repl.notebook.cells.every((_, index) => !repl.notebook.isExperimental(index))).toBe(true);
        } finally { session.dispose(); }
    });
});
