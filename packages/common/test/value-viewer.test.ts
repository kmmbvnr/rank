import { describe, expect, it } from 'vitest';
import { NotebookRepl } from '../src/repl.js';
import { TerminalModeRouter } from '../src/terminal-modes.js';
import { createReplSession } from '../src/repl-session.js';
import { viewerFrame } from '../src/screen.js';

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '');

/** Runs `sources` as cells, then opens the result of the last one in the viewer on a screen of `columns` by `rows`. */
async function opened(columns: number, rows: number, files: Record<string, string>, ...sources: string[]) {
    const session = createReplSession({ options: { io: { read: (path: string) => {
        const text = files[path];
        if (text === undefined) throw new Error(`no ${path}`);
        return new TextEncoder().encode(text);
    } } as never } });
    const repl = new NotebookRepl(session, () => {}, () => columns);
    repl.rows = () => rows;
    const modes = new TerminalModeRouter(repl, () => rows);
    for (const source of sources) {
        repl.notebook.replace(source);
        await repl.submit(true);
    }
    const last = repl.notebook.cells.findLastIndex(cell => cell.status === 'ok' && cell.output.some(line => line.view));
    expect(last).toBeGreaterThanOrEqual(0);
    await repl.openValue(repl.notebook.cells[last].id);
    const viewer = repl.help!.viewer!;
    const press = async (name: string, extra: { text?: string; shift?: boolean } = {}) =>
        modes.press(extra.text ?? '', { name, shift: extra.shift });
    const screen = () => viewerFrame(viewer, columns, rows).lines.map(plain);
    return { session, repl, viewer, press, screen };
}

describe('the value viewer', () => {
    it('shows a 3 by 4 array with its labels and fits the screen', async () => {
        const { session, screen } = await opened(40, 10, {}, 'M = array shape 3 4 fill 7');
        try {
            const lines = screen();
            expect(lines).toHaveLength(10);
            expect(lines[0]).toContain('integer · [3 4]');
            expect(lines[1]).toMatch(/0 +1 +2 +3/);
            expect(lines[2]).toMatch(/^0 │ +7 +7 +7 +7/);
            expect(lines[4]).toMatch(/^2 │/);
            expect(lines[9]).toContain('rows 1–3 of 3');
        } finally { session.dispose(); }
    });

    it('scrolls a long vector by line, page and end, asking only for the rows it shows', async () => {
        const { session, viewer, press, screen } = await opened(40, 8, {}, 'V = array shape 100 fill 1');
        try {
            expect(viewer.view).toMatchObject({ kind: 'grid', cells: expect.arrayContaining([['1']]) });
            expect(screen()[9 - 4]).toBeDefined();
            expect(screen().filter(line => /^\s*\d+ │/.test(line))).toHaveLength(5);
            await press('down');
            expect(screen()[2]).toMatch(/^ *1 │/);
            await press('pagedown');
            expect(screen()[2]).toMatch(/^ *5 │/);
            await press('end');
            expect(screen()[2]).toMatch(/^ *95 │/);
            expect(screen().at(-1)).toContain('rows 96–100 of 100');
            await press('down');
            expect(screen().at(-1)).toContain('rows 96–100 of 100');
            await press('home');
            expect(screen()[2]).toMatch(/^ *0 │/);
        } finally { session.dispose(); }
    });

    it('scrolls a wide table sideways, by cell and by screen', async () => {
        const header = Array.from({ length: 12 }, (_, index) => `column_${index}`).join(',');
        const row = Array.from({ length: 12 }, (_, index) => index * 11).join(',');
        const csv = `${header}\n${row}\n${row}\n`;
        const { session, press, screen } = await opened(36, 8, { '/in.csv': csv }, 'use tables', 'T = "/in.csv" csv');
        try {
            expect(screen()[0]).toContain('table');
            expect(screen()[1]).toContain('column_0');
            expect(screen()[1]).not.toContain('column_5');
            expect(screen().at(-1)).toMatch(/columns 1–\d of 12/);
            await press('right');
            expect(screen()[1]).not.toContain('column_0');
            expect(screen()[1]).toContain('column_1');
            await press('right', { shift: true });
            const header2 = screen()[1];
            expect(header2).not.toContain('column_1 ');
            expect(header2).toMatch(/column_\d+/);
            for (let step = 0; step < 20; step++) await press('right');
            expect(screen()[1]).toContain('column_11');
            await press('left', { shift: true });
            expect(screen()[1]).toContain('column_10');
        } finally { session.dispose(); }
    });

    it('switches the slice of a 3-D array with [ and ]', async () => {
        const { session, viewer, press, screen } = await opened(40, 10, {}, 'use sequences', 'A = (1 to 24) (array 2 3 4) reshape');
        try {
            expect(screen()[0]).toContain('[0, :, :]');
            expect(screen()[2]).toMatch(/^0 │ +1 +2 +3 +4/);
            expect(screen().at(-1)).toContain('slice 1 of 2');
            await press('', { text: ']' });
            expect(screen()[0]).toContain('[1, :, :]');
            expect(screen()[2]).toMatch(/^0 │ +13 +14 +15 +16/);
            expect(screen().at(-1)).toContain('slice 2 of 2');
            await press('', { text: ']' });
            expect(screen()[0]).toContain('[1, :, :]');
            await press('', { text: '[' });
            expect(screen()[0]).toContain('[0, :, :]');
            expect(viewer.view.kind).toBe('grid');
        } finally { session.dispose(); }
    });

    it('lists a record as keys and values', async () => {
        const { session, screen } = await opened(40, 8, {}, 'R = record\n .name = "ada"\n .age = 36\nend');
        try {
            const lines = screen();
            expect(lines[0]).toContain('record');
            expect(lines[1]).toContain('key');
            expect(lines.some(line => /^name +ada/.test(line))).toBe(true);
            expect(lines.some(line => /^age +36/.test(line))).toBe(true);
        } finally { session.dispose(); }
    });

    it('closes with Esc back onto the result row when it was opened from that row, and Enter reopens it', async () => {
        const { session, repl, press } = await opened(40, 8, {}, 'M = array shape 3 4 fill 7');
        try {
            repl.closeViewer();
            expect(repl.valueFocus).toBeUndefined();
            repl.focusResult(repl.notebook.cells[0].id);
            await repl.openValue();
            expect(repl.help?.viewer?.restoreFocus).toBe(true);
            await press('escape');
            expect(repl.help).toBeUndefined();
            expect(repl.valueFocus).toBe(repl.notebook.cells[0].id);
            await repl.openValue();
            expect(repl.help?.viewer).toBeDefined();
        } finally { session.dispose(); }
    });

    it('leaves the result row unselected when it was opened by a tap', async () => {
        const { session, repl, press } = await opened(40, 8, {}, 'M = array shape 3 4 fill 7');
        try {
            expect(repl.help?.viewer?.restoreFocus).toBe(false);
            await press('escape');
            expect(repl.help).toBeUndefined();
            expect(repl.valueFocus).toBeUndefined();
        } finally { session.dispose(); }
    });

    it('closes with the value gone message when the value was released', async () => {
        const { session, repl, press } = await opened(40, 8, {}, 'V = array shape 100 fill 1');
        try {
            await session.resetExecution();
            await press('down');
            expect(repl.help).toBeUndefined();
            expect(repl.suggestion).toContain('gone');
        } finally { session.dispose(); }
    });
});
