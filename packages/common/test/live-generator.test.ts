import { expect, it } from 'vitest';
import { KeyRouter } from '../src/key-router.js';
import { NotebookRepl } from '../src/repl.js';
import { createReplSession } from '../src/repl-session.js';

it('defines a parameterless generator without running its unbounded loop', async () => {
    const repl = new NotebookRepl(createReplSession(), () => {}, () => 80, true);
    const keys = new KeyRouter(repl);
    for (const line of ['fun fibonacci', 'N = 1', 'for', 'yield N', 'N += 1', 'end', 'end']) {
        for (const character of line) await keys.press(character);
        await keys.press('', { name: 'return' });
    }

    expect(repl.notebook.cells[0].status).toBe('ok');
    expect(repl.notebook.cells[0].source)
        .toBe('fun fibonacci\n  N = 1\n  for\n    yield N\n    N += 1\n  end\nend');
});
