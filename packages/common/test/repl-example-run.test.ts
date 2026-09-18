import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

describe('Ctrl-R while typing an example argument', () => {
    it('accepts the value and moves to the next parameter, like Enter', async () => {
        const repl = new NotebookRepl(createReplSession(), () => {}, () => 80, true);
        const keys = new KeyRouter(repl);
        repl.notebook.replace('fun add a b');

        await keys.press('', { name: 'return' });
        expect(repl.examplePrompt).toMatchObject({ parameter: 'a', index: 0 });

        await keys.press('1');
        await keys.press('', { ctrl: true, name: 'r' });

        expect(repl.examplePrompt).toMatchObject({ parameter: 'b', index: 1 });
        expect(repl.exampleFields?.[0].source).toBe('1');
    });

    it('runs the body once the last example is accepted', async () => {
        const repl = new NotebookRepl(createReplSession(), () => {}, () => 80, true);
        const keys = new KeyRouter(repl);
        repl.notebook.replace('fun add a b');

        await keys.press('', { name: 'return' });
        await keys.press('1');
        await keys.press('', { ctrl: true, name: 'r' });
        await keys.press('2');
        await keys.press('', { ctrl: true, name: 'r' });

        expect(repl.examplePrompt).toBeUndefined();
        expect(repl.exampleFields?.map(field => field.source)).toEqual(['1', '2']);
    });
});
