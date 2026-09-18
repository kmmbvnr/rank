import { expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

it('keeps body input typed while an example argument is being checked', async () => {
    const session = createReplSession();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const checking = new Promise<void>(resolve => { started = resolve; });
    const repl = new NotebookRepl({ ...session, preview: async (...args) => {
        started();
        await waiting;
        return session.preview(...args);
    } }, undefined, undefined, true);
    const keys = new KeyRouter(repl);
    try {
        await keys.press('fun inc N');
        await keys.press('', { name: 'return' });
        await keys.press('4');
        const accept = keys.press('', { name: 'return' });
        await checking;
        const typing = keys.press('Result = N + 1');
        release();
        await Promise.all([accept, typing]);
        expect(repl.notebook.current.source).toBe('fun inc N\n  Result = N + 1');
        expect(repl.exampleEditor).toBeUndefined();
    } finally {
        release();
        session.dispose();
    }
});
