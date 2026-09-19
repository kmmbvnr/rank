import { describe, expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

async function loopFunction(enterAfterHeader = true): Promise<{ repl: NotebookRepl; keys: KeyRouter }> {
    const repl = new NotebookRepl(createReplSession(), () => {}, () => 80, true);
    const keys = new KeyRouter(repl);
    repl.notebook.replace('fun sum n');
    await keys.press('', { name: 'return' });
    await keys.press('4');
    await keys.press('', { name: 'return' });
    for (const text of 'Total = 0') await keys.press(text);
    await keys.press('', { name: 'return' });
    for (const text of 'for i in 1 to n') await keys.press(text);
    if (enterAfterHeader) await keys.press('', { name: 'return' });
    return { repl, keys };
}

describe('loop iteration steppers', () => {
    it('offers stepping while the cursor sits inside a previewed loop', async () => {
        const { repl } = await loopFunction();

        expect(repl.liveIterationFocus).toBeUndefined();
        expect(repl.liveIterationAvailable).toBe(true);
    });

    it('steps the iteration after the loop line is selected', async () => {
        const { repl, keys } = await loopFunction();

        await keys.press('', { ctrl: true, name: 'g' });
        expect(repl.liveIterationFocus?.active).toBe(true);

        await keys.press('', { name: 'right' });
        await keys.press('', { name: 'right' });

        expect(repl.liveOutputs?.get(repl.liveIterationFocus!.line)?.[0].text).toContain('iteration 3');
    });

    it('moves past the previewed loop on the next run, without a spent press', async () => {
        const { repl, keys } = await loopFunction(false);
        const line = () => repl.notebook.current.source.slice(0, repl.notebook.cursor).split('\n').length;

        await keys.press('', { ctrl: true, name: 'r' });
        expect(repl.liveIterationFocus?.line).toBe(3);
        expect(line()).toBe(3);

        await keys.press('', { ctrl: true, name: 'r' });

        expect(repl.liveIterationFocus).toBeUndefined();
        expect(line()).toBe(4);
    });

    it('stays hidden with no loop around the cursor', async () => {
        const repl = new NotebookRepl(createReplSession(), () => {}, () => 80, true);
        repl.notebook.replace('Total = 0');

        expect(repl.liveIterationAvailable).toBe(false);
    });
});
