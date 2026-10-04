import { expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

it('previews an unpack line inside a loop as the first name it binds', async () => {
    const repl = new NotebookRepl(createReplSession(), () => {}, () => 80, true);
    const keys = new KeyRouter(repl);
    const enter = async (line: string) => {
        for (const character of line) await keys.press(character);
        await keys.press('', { name: 'return' });
        await new Promise(resolve => setTimeout(resolve, 300));
    };
    await enter('Heads = array 3 9 2');
    for (const line of ['for', 'unpack Best Row = Heads max .indexed']) await enter(line);
    expect(repl.liveOutputs?.get(2)).toEqual([{ text: '9', error: false }]);
    await enter('if Best equal 0');
    expect(repl.liveOutputs?.get(3)?.[0].error).toBe(false);
});
