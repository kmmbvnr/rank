import { describe, expect, it } from 'vitest';
import { createReplSession } from '../src/repl-session.js';
import { NotebookRepl } from '../src/repl.js';
import { EnvironmentOverlay } from '@arrrank/interpreter';
import { formatSource } from '../src/source-format.js';

describe('session environments', () => {
    it('replaces a function through its own notebook cell and previews without changing it', async () => {
        const session = createReplSession();
        const source = 'fun answer\n  return 1\nend';
        try {
            expect(await session.prepareFunctions([{ id: 0, source }])).toMatchObject([{ output: [] }]);
            expect((await session.execute(source, 0, [], 40, true)).ok).toBe(true);
            expect(session.preview('fun answer\n  return 2\nend\nanswer').output.map(line => line.text)).toEqual(['2']);
            expect((await session.execute('answer', 1, [], 40, true)).output.map(line => line.text)).toEqual(['1']);
            expect((await session.execute('fun answer\n  return 3\nend', 2, [], 40, true)).ok).toBe(false);
            expect((await session.execute('fun answer\n  return 4\nend', 0, [], 40, true)).ok).toBe(true);
            expect((await session.execute('answer', 1, [], 40, true)).output.map(line => line.text)).toEqual(['4']);
            await session.execute('fun X inc = X + 1', 3, [], 40, true);
            expect(session.preview('fun X inc = X + 2\n1 inc').output.map(line => line.text)).toEqual(['3']);
        } finally { session.dispose(); }
    });
    it('survives clean execution resets but clears at a notebook boundary', async () => {
        const session = createReplSession();
        try {
            await session.execute('use cli\nenv "HOST" = "session"', 0, [], 40, true);
            session.resetExecution();
            expect((await session.execute('use cli\n"HOST" env', 1, [], 40, true)).output.map(line => line.text)).toEqual(['session']);
            const repl = new NotebookRepl(session, () => {}, () => 80);
            await repl.restoreNotebook(['use cli'], '');
            expect((await session.execute('use cli\n"HOST" env default "empty"', 2, [], 40, true)).output.map(line => line.text)).toEqual(['empty']);
        } finally { session.dispose(); }
    });
    it('restores the host snapshot when a different file is opened', async () => {
        const session = createReplSession({ options: { environment: EnvironmentOverlay.from([['HOST', 'inherited']]) } });
        try {
            await session.execute('use cli\nenv "HOST" = "changed"', 0, [], 40, true);
            session.replaceFile({ path: 'next.ra', source: 'use cli\n"HOST" env' });
            expect((await session.execute('use cli\n"HOST" env', 0, [], 40, true)).output.map(line => line.text)).toEqual(['inherited']);
        } finally { session.dispose(); }
    });
    it('runs previews in an overlay and preserves statement formatting', async () => {
        const environment = EnvironmentOverlay.from([['HOST', 'base']]);
        const session = createReplSession({ options: { environment } });
        try {
            await session.execute('use cli', 0, [], 40, true);
            const preview = session.preview('env "HOST" = "preview"\n"HOST" env');
            expect(preview.ok).toBe(true);
            expect(preview.output.map(line => line.text)).toContain('preview');
            expect((await session.execute('"HOST" env', 1, [], 40, true)).output.map(line => line.text)).toEqual(['base']);
            expect(formatSource('env Name = "value"', 40)).toBe('env Name = "value"');
        } finally { session.dispose(); }
    });
    it('forces a stored generator preview without writing the session environment', async () => {
        const session = createReplSession();
        try {
            await session.execute('use cli\nenv "HOST" = "base"\nfun changes\n  env "HOST" = "preview"\n  yield "HOST" env\nend', 0, [], 40, true);
            await session.execute('Values = changes', 1, [], 40, true, false, true);
            expect(session.preview('Values').ok).toBe(true);
            expect((await session.execute('"HOST" env', 2, [], 40, true)).output.map(line => line.text)).toEqual(['base']);
        } finally { session.dispose(); }
    });
});
