import { expect, it } from 'vitest';
import { LivePreviewRunner } from '../src/live-preview.js';
import { createReplSession } from '../src/repl-session.js';

it('discards an older iteration preview that finishes after the new selection', async () => {
    const session = createReplSession();
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const runner = new LivePreviewRunner(async source => {
        const result = await session.preview(source);
        if (first) {
            first = false;
            await delayed;
        }
        return result;
    });
    const state = { outputs: new Map(), prefixes: new Map(), iterations: new Map([[1, 0]]) };
    const source = 'for i in 1 to 10\n  if i less 4\n    i\n  else\n    i + 1\n  end\nend';
    try {
        const older = runner.updateConditional(state, source, true, 4);
        // Let the first preview reach the delayed response.
        await Promise.resolve();
        state.iterations.set(1, 8);
        await runner.updateConditional(state, source, true, 4);
        release();
        await older;
        expect(state.outputs.get(1)).toEqual([{ text: 'i = 9 · iteration 9', error: false }]);
        expect(state.outputs.get(4)).toEqual([{ text: 'branch runs', error: false }]);
        expect(state.outputs.has(5)).toBe(false);
    } finally {
        release();
        session.dispose();
    }
});
