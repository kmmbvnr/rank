import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

describe('fast run', () => {
    const run = async (fast: boolean) => {
        const session = Object.assign(createReplSession(), { turboActive: fast });
        const repl = new NotebookRepl(session);
        for (const source of ['Count = 1', 'Count + 1', 'Count + 2', 'Total = Count + 3']) repl.notebook.enqueue(source);
        await new KeyRouter(repl).press('', { ctrl: true, name: 'l' });
        return repl.notebook.cells.slice(0, 4).map(cell => cell.output.map(line => line.text));
    };

    it('shows every result in a normal run all', async () => {
        expect(await run(false)).toEqual([['1'], ['2'], ['3'], ['4']]);
    });

    it('shows only the last result', async () => {
        expect(await run(true)).toEqual([[], [], [], ['4']]);
    });
});

describe('fast run footer', () => {
    const footer = async (fast: boolean, ...sources: string[]) => {
        const repl = new NotebookRepl(Object.assign(createReplSession(), { turboActive: fast }));
        for (const source of sources) repl.notebook.enqueue(source);
        const keys = new KeyRouter(repl);
        await keys.press('', { ctrl: true, name: 'l' });
        return { repl, keys };
    };

    it('reports the total time after a fast run and clears it on the next key', async () => {
        const { repl, keys } = await footer(true, 'Count = 1', 'Count + 1');
        expect(repl.suggestion).toMatch(/^Done in \d+\.\d\ds$/);
        await keys.press('x', { name: 'x' });
        expect(repl.suggestion).not.toMatch(/^Done in/);
    });

    it('shows no time after a normal run all or a failed run', async () => {
        expect((await footer(false, 'Count = 1')).repl.suggestion).not.toMatch(/^Done in/);
        expect((await footer(true, 'Missing')).repl.suggestion).not.toMatch(/^Done in/);
    });
});
