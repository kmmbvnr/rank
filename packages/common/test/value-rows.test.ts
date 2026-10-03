import { describe, expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { KeyRouter } from '../src/key-router.js';
import { createReplSession } from '../src/repl-session.js';
import { notebookFrame } from '../src/screen.js';

/** A notebook whose first cells were run: `sources` are submitted in order, then the prompt is empty. */
async function ran(...sources: string[]) {
    const session = createReplSession();
    const repl = new NotebookRepl(session, () => {}, () => 80);
    const router = new KeyRouter(repl, [], () => 80);
    for (const source of sources) {
        repl.notebook.replace(source);
        await repl.submit(true);
    }
    const key = (name: string) => router.press('', { name });
    const frame = () => notebookFrame(repl.notebook, 80, 24, 0, repl.suggestion, false, true, '', 'Running…',
        undefined, 'rank> ', undefined, undefined, undefined, false, undefined, true, 0, undefined,
        repl.importFixFocus, undefined, repl.valueFocus);
    const text = () => frame().lines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
    return { session, repl, key, frame, text };
}

describe('navigable result rows', () => {
    it('says what an openable result is, and leaves a scalar result alone', async () => {
        const { session, text } = await ran('M = array shape 3 4 fill 1', '1 + 2');
        try {
            const lines = text();
            expect(lines.some(line => line.includes('integer [3 4] · '))).toBe(true);
            expect(lines.filter(line => line.includes('·'))).toHaveLength(1);
            expect(lines.some(line => line.trim() === '3')).toBe(true);
        } finally { session.dispose(); }
    });

    it('marks the result row of an array as a value target and not a scalar', async () => {
        const { session, frame } = await ran('A = array 1 2 3', '5');
        try {
            const targets = frame().targets!.filter(target => target?.kind === 'value');
            expect(targets).toHaveLength(1);
            expect(targets[0]).toMatchObject({ kind: 'value', cell: 0, points: [] });
            expect(typeof targets[0]!.ref).toBe('number');
        } finally { session.dispose(); }
    });

    it('lands on the result with Up from the next cell, and Enter opens the viewer', async () => {
        const { session, repl, key, frame, text } = await ran('A = array 1 2 3');
        try {
            await key('up');
            expect(repl.valueFocus).toBe(repl.notebook.cells[0].id);
            expect(repl.suggestion).toContain('Enter view');
            expect(text().some(line => line.includes('Enter view'))).toBe(true);
            expect(frame().lines.some(line => line.startsWith('\x1b[7m'))).toBe(true);
            await key('return');
            expect(repl.valueFocus).toBeUndefined();
            expect(repl.help?.text).toContain('integer');
            expect(repl.help?.text).toMatch(/0 +1\n1 +2\n2 +3/);
        } finally { session.dispose(); }
    });

    it('leaves the row with Esc, with Up and with Down', async () => {
        const { session, repl, key } = await ran('A = array 1 2 3');
        try {
            await key('up');
            await key('escape');
            expect(repl.valueFocus).toBeUndefined();
            expect(repl.notebook.active).toBe(0);
            await key('down');
            expect(repl.valueFocus).toBe(repl.notebook.cells[0].id);
            await key('up');
            expect(repl.valueFocus).toBeUndefined();
            expect(repl.notebook.active).toBe(0);
            await key('down');
            await key('down');
            expect(repl.valueFocus).toBeUndefined();
            expect(repl.notebook.active).toBe(1);
            expect(repl.help).toBeUndefined();
        } finally { session.dispose(); }
    });

    it('skips a scalar result', async () => {
        const { session, repl, key } = await ran('1 + 2');
        try {
            await key('up');
            expect(repl.valueFocus).toBeUndefined();
            expect(repl.notebook.active).toBe(0);
        } finally { session.dispose(); }
    });

    it('opens a record and a table-shaped value, and says so for a stale one', async () => {
        const { session, repl, key } = await ran('R = record\n .x = 1\nend');
        try {
            await key('up');
            await key('return');
            expect(repl.help?.text).toContain('record');
            expect(repl.help?.text).toContain('x');
        } finally { session.dispose(); }
        const stale = await ran('A = array 1 2 3');
        try {
            await stale.key('up');
            await stale.session.resetExecution();
            await stale.key('return');
            expect(stale.repl.help).toBeUndefined();
            expect(stale.repl.suggestion).toContain('gone');
        } finally { stale.session.dispose(); }
    });

    it('opens the result of a tapped cell without moving through it', async () => {
        const { session, repl } = await ran('A = array 1 2 3', '2');
        try {
            await repl.openValue(repl.notebook.cells[0].id);
            expect(repl.help?.text).toMatch(/0 +1\n1 +2\n2 +3/);
        } finally { session.dispose(); }
    });
});
