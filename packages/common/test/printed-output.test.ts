import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';
import { NotebookRepl } from '../src/repl.js';
import { notebookFrame } from '../src/screen.js';

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '');
const printing = (count: number) => `use io\nfor N in 1 to ${count}\n  N print\nend`;

async function printed(source: string, width = 40) {
    const session = createReplSession();
    const repl = new NotebookRepl(session, () => {}, () => width);
    repl.notebook.replace(source);
    await repl.submit(true);
    const cell = repl.notebook.cells.find(cell => cell.output.some(line => line.printed))!;
    const ref = cell.output.find(line => line.printed)!.ref!;
    const frame = notebookFrame(repl.notebook, width, 30);
    const rows = frame.lines.filter((_, row) => frame.targets?.[row]?.ref === ref).map(plain).map(line => line.trim());
    return { session, repl, cell, ref, frame, rows };
}

describe('compact printed output', () => {
    it.each([1, 5, 6, 100])('shows at most five visible lines for %i printed lines', async count => {
        const { session, rows } = await printed(printing(count));
        try {
            expect(rows).toEqual(count <= 5 ? Array.from({ length: count }, (_, index) => String(index + 1))
                : ['1', '2', '3', '4', '… · full output']);
        } finally { session.dispose(); }
    });

    it('counts wrapped rows and keeps even very long lines intact in the viewer', async () => {
        const text = 'x'.repeat(20_000);
        const { session, rows, ref } = await printed(`use io\n"${text}" print`);
        try {
            expect(rows).toHaveLength(5);
            expect(rows[4]).toBe('… · full output');
            expect(session.inspect(ref)).toMatchObject({ status: 'ok', kind: 'entries', size: 1,
                entries: [{ key: '1', value: { text } }] });
        } finally { session.dispose(); }
    });

    it('does not add a blank row after text that exactly fills five rows', async () => {
        const { session, rows } = await printed(`use io\n"${'x'.repeat(33 * 5)}" print`);
        try {
            expect(rows).toEqual(Array(5).fill('x'.repeat(33)));
        } finally { session.dispose(); }
    });

    it('opens all printed lines, pages them, and invalidates them when the cell reruns', async () => {
        const { session, repl, cell, ref } = await printed(printing(100));
        try {
            expect(await repl.openValue(cell.id, ref)).toBe(true);
            expect(repl.help?.viewer?.view).toMatchObject({ kind: 'list', scroll: { length: 100 } });
            expect(session.inspect(ref, { offset: [95], count: [10] })).toMatchObject({ status: 'ok', size: 100,
                entries: Array.from({ length: 5 }, (_, index) => ({ key: String(index + 96), value: { text: String(index + 96) } })) });
            await session.execute('1', cell.id, [], 40, true);
            expect(session.inspect(ref)).toEqual({ status: 'stale' });
        } finally { session.dispose(); }
    });

    it('keeps printed output separate from the returned value in the same cell', async () => {
        const { session, repl, cell, ref } = await printed('use io\nfun values\n  for N in 1 to 6\n    N print\n  end\n  return array 7 8\nend\nvalues');
        try {
            const value = cell.output.find(line => line.view && !line.printed)!;
            expect(value.ref).not.toBe(ref);
            expect(await repl.openValue(cell.id, value.ref)).toBe(true);
            expect(repl.help?.viewer?.view).toMatchObject({ kind: 'grid', cells: [['7'], ['8']] });
            repl.closeViewer();
            expect(await repl.openValue(cell.id, ref)).toBe(true);
            expect(repl.help?.viewer?.view).toMatchObject({ kind: 'list', scroll: { length: 6 } });
            session.resetExecution();
            expect(session.inspect(ref)).toEqual({ status: 'stale' });
            expect(session.inspect(value.ref!)).toEqual({ status: 'stale' });
        } finally { session.dispose(); }
    });

    it('keeps diagnostics visible and printed output openable after an error', async () => {
        const { session, repl, cell, ref, frame, rows } = await printed('use io\nfun fail\n  for N in 1 to 6\n    N print\n  end\n  return 1 / 0\nend\nfail');
        try {
            expect(rows).toHaveLength(5);
            expect(frame.lines.map(plain).join('\n')).toMatch(/division by zero/);
            expect(await repl.openValue(cell.id, ref)).toBe(true);
            expect(repl.help?.viewer?.view).toMatchObject({ kind: 'list', scroll: { length: 6 } });
        } finally { session.dispose(); }
    });
});
