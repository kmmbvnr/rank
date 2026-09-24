import { expect, it } from 'vitest';
import { LiveFunctionSession } from '../src/live-function.js';
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

it('previews a generator body past an earlier yield', async () => {
    const session = createReplSession();
    const runner = new LivePreviewRunner(source => session.preview(source));
    const source = 'fun src\n  Pos = array 1 1\n  for # in 1 to 5\n    Pos 0 += 1\n    yield Pos\n  end';
    const live = new LiveFunctionSession(
        { name: 'src', parameters: [], header: 'fun src', source, cellId: 1, existing: false }, []);
    try {
        await runner.updateFunction(live, source, true);
        expect(live.outputs.get(5)).toEqual([{ text: '2 1', error: false }]);
        // The closing `end` runs the whole loop, which a yield must not turn
        // into a generator: the preview returns the value it reached.
        expect(live.outputs.get(6)).toEqual([{ text: '6 1', error: false }]);
    } finally {
        session.dispose();
    }
});

it('shows recursive call for lines invoking the function being defined', async () => {
    const session = createReplSession();
    const runner = new LivePreviewRunner(source => session.preview(source));
    const source = [
        'memo fib N',
        '  if N less 2',
        '    return N',
        '  else',
        '    Fib1 = N - 1 fib',
        '    Fib2 = N - 2 fib',
        '    return Fib1 + Fib2',
        '  end',
    ].join('\n');
    const live = new LiveFunctionSession(
        { name: 'fib', parameters: ['N'], header: 'memo fib N', source,
          values: ['5'], cellId: 1, existing: false }, []);
    try {
        await runner.updateFunction(live, source, true);
        // Line 2: if N less 2 -> false · branch skipped
        expect(live.outputs.get(2)).toEqual([{ text: 'false · branch skipped', error: false }]);
        // Line 4: else -> branch runs
        expect(live.outputs.get(4)).toEqual([{ text: 'branch runs', error: false }]);
        // Line 5: Fib1 = N - 1 fib -> recursive call
        expect(live.outputs.get(5)).toEqual([{ text: 'recursive call', error: false }]);
        // Line 6: Fib2 = N - 2 fib -> recursive call
        expect(live.outputs.get(6)).toEqual([{ text: 'recursive call', error: false }]);
        // Line 7: return Fib1 + Fib2 -> recursive call (not a runtime error!)
        expect(live.outputs.get(7)).toEqual([{ text: 'recursive call', error: false }]);
    } finally {
        session.dispose();
    }
});
