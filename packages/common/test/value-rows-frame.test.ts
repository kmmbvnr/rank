import { describe, expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';
import { notebookFrame } from '../src/screen.js';

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '');

describe('result rows in a frame', () => {
    it('marks the rows that show a result, a value or an error, and no code row', async () => {
        const session = createReplSession();
        const repl = new NotebookRepl(session, () => {}, () => 80);
        try {
            for (const source of ['A = array 1 2 3', '1 + 2', '1 / 0']) {
                repl.notebook.replace(source);
                await repl.submit(true);
            }
            const frame = notebookFrame(repl.notebook, 80, 24);
            const lines = frame.lines.map(plain);
            const marked = (frame.resultRows ?? []).map(row => lines[row].trim());
            // The array's preview and its type row, the scalar, then the error: results, never the source lines.
            expect(marked.slice(0, 3)).toEqual(['1 2 3', 'integer [3]', '3']);
            expect(marked.slice(3).join(' ')).toMatch(/division by zero/);
            for (const row of frame.resultRows ?? []) expect(lines[row]).not.toMatch(/[●›]/);
            const source = lines.map((line, row) => [line, row] as const).filter(([line]) => /^[●·]|›/.test(line.trim()));
            expect(source.length).toBeGreaterThan(0);
            for (const [, row] of source) expect(frame.resultRows).not.toContain(row);
        } finally { session.dispose(); }
    });

    it('keeps the indexes relative to the visible rows when the frame is scrolled', async () => {
        const session = createReplSession();
        const repl = new NotebookRepl(session, () => {}, () => 80);
        try {
            for (const source of ['1 + 1', '2 + 2', '3 + 3', '4 + 4']) {
                repl.notebook.replace(source);
                await repl.submit(true);
            }
            const frame = notebookFrame(repl.notebook, 80, 5, 3, '', false, false);
            const lines = frame.lines.map(plain);
            expect(frame.top).toBeGreaterThan(0);
            for (const row of frame.resultRows ?? []) expect(lines[row].trim()).toMatch(/^\d+$/);
            expect(frame.resultRows?.length).toBeGreaterThan(0);
        } finally { session.dispose(); }
    });
});
