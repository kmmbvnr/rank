import { expect, it } from 'vitest';
import { LiveFunctionSession } from '../src/live-function.js';
import { LivePreviewRunner } from '../src/live-preview.js';
import { createReplSession } from '../src/repl-session.js';

it('discards an older iteration preview that finishes after the new selection', async () => {
    const session = createReplSession();
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    const runner = new LivePreviewRunner(async (source, syntheticNames) => {
        const result = await session.preview(source, 80, false, syntheticNames);
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
    const runner = new LivePreviewRunner((source, syntheticNames) =>
        session.preview(source, 80, false, syntheticNames));
    const source = 'fun src\n  Pos = array 1 1\n  for # in 1 to 5\n    Pos 0 += 1\n    yield Pos\n  end';
    const live = new LiveFunctionSession(
        { name: 'src', parameters: [], header: 'fun src', source, cellId: 1, existing: false }, []);
    try {
        await runner.updateFunction(live, source, true);
        expect(live.outputs.get(5)).toEqual([{ text: '2 1', error: false }]);
        // The closing `end` runs the whole loop, which a yield must not turn
        // into a generator: the preview summarizes the state after the loop.
        expect(live.outputs.get(6)).toEqual([{ text: 'Pos = 6 1 · 5 iterations', error: false }]);
    } finally {
        session.dispose();
    }
});

it('shows recursive call for lines invoking the function being defined', async () => {
    const session = createReplSession();
    const runner = new LivePreviewRunner((source, syntheticNames) =>
        session.preview(source, 80, false, syntheticNames));
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

it('times out long-running previews and skips them in subsequent updates', async () => {
    let interrupted = false;
    const progressUpdates: string[] = [];
    let delayMs = 100;
    const runner = new LivePreviewRunner(
        async source => {
            if (source.includes('Slow')) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
                if (interrupted) {
                    return { ok: false, output: [], source, command: false, exit: false, interrupted: true };
                }
            }
            return { ok: true, output: [{ text: '42', error: false }], source, command: false, exit: false };
        },
        {
            timeoutMs: 50,
            progressDelayMs: 20,
            onProgress: status => { if (status) progressUpdates.push(status); },
            interrupt: () => { interrupted = true; },
        },
    );
    const source = 'fun compute\n  Slow = 1\n  Slow + 1\nend';
    const live = new LiveFunctionSession(
        { name: 'compute', parameters: [], header: 'fun compute', source, cellId: 1, existing: false }, []);
    await runner.updateFunction(live, source, true);
    // Line 2 (Slow = 1) should have timed out
    expect(interrupted).toBe(true);
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(live.slowLines.has(2)).toBe(true);
    expect(live.outputs.get(2)).toEqual([{ text: 'timeout (>1.5s) · ^R to evaluate', error: false }]);

    // On subsequent update (typing more code, reset = false), slow line is skipped immediately without re-evaluating
    interrupted = false;
    let evalCount = 0;
    const runner2 = new LivePreviewRunner(
        async source => {
            evalCount++;
            return { ok: true, output: [{ text: '42', error: false }], source, command: false, exit: false };
        },
        { timeoutMs: 50 },
    );
    // Line 2 is in slowLines
    live.outputs.clear();
    await runner2.updateFunction(live, source, false);
    // Line 2 should stay annotated as timeout without triggering preview
    expect(live.outputs.get(2)).toEqual([{ text: 'timeout (>1.5s) · ^R to evaluate', error: false }]);

    // But when reset is true (Ctrl-R forced run), slowLines are cleared and it evaluates
    await runner2.updateFunction(live, source, true);
    expect(live.slowLines.has(2)).toBe(false);
    expect(live.outputs.get(2)).toEqual([{ text: '42', error: false }]);
});

it('handles manual preview cancellation via interrupt', async () => {
    const runner = new LivePreviewRunner(
        async () => ({ ok: false, output: [], source: '', command: false, exit: false, interrupted: true }),
        { timeoutMs: 5000 },
    );
    const source = 'fun compute\n  X = 1\nend';
    const live = new LiveFunctionSession(
        { name: 'compute', parameters: [], header: 'fun compute', source, cellId: 1, existing: false }, []);
    await runner.updateFunction(live, source, true);
    expect(live.outputs.get(2)).toEqual([{ text: 'cancelled · ^R to evaluate', error: false }]);
    expect(live.slowLines.has(2)).toBe(true);
});

async function previewFunction(name: string, parameters: string[], values: string[], source: string) {
    const session = createReplSession();
    const runner = new LivePreviewRunner((text, syntheticNames) => session.preview(text, 80, false, syntheticNames));
    const header = source.split('\n')[0];
    const live = new LiveFunctionSession({ name, parameters, header, source, values, cellId: 1, existing: false }, []);
    try {
        await runner.updateFunction(live, source, true);
        return live.outputs;
    } finally {
        session.dispose();
    }
}

it('shows no preview on the end of a conditional block', async () => {
    const fib = ['memo fib N', '  if N at most 2', '    return N', '  else', '    Fib1 = N - 1 fib',
        '    Fib2 = N - 2 fib', '    return Fib1 + Fib2', '  end'].join('\n');
    const outputs = await previewFunction('fib', ['N'], ['1'], fib);
    expect(outputs.has(8)).toBe(false);
    const branches = await previewFunction('f', ['N'], ['1'],
        ['fun f N', '  if N at most 2', '    X = 1', '  else', '    Y = 2', '  end'].join('\n'));
    expect(branches.has(6)).toBe(false);
    for (const lines of branches.values()) for (const line of lines) expect(line.error).toBe(false);
});

it('summarizes a loop on its end by the outer names it changes and its iteration count', async () => {
    const outputs = await previewFunction('g', ['N'], ['5'],
        ['fun g N', '  Total = 0', '  for I in 1 to N', '    Sq = I * I', '    Total += Sq', '  end'].join('\n'));
    expect(outputs.get(6)).toEqual([{ text: 'Total = 55 · 5 iterations', error: false }]);
});

it('shows only the iteration count for a loop that changes no outer name', async () => {
    const outputs = await previewFunction('g', ['N'], ['5'],
        ['fun g N', '  for I in 1 to N', '    Sq = I * I', '  end'].join('\n'));
    expect(outputs.get(4)).toEqual([{ text: '5 iterations', error: false }]);
});

it('summarizes a loop in a conditional preview', async () => {
    const session = createReplSession();
    const runner = new LivePreviewRunner((text, syntheticNames) => session.preview(text, 80, false, syntheticNames));
    const state = { outputs: new Map(), prefixes: new Map(), iterations: new Map() };
    try {
        await runner.updateConditional(state, 'if true\n  Total = 0\n  for I in 1 to 3\n    Total += I\n  end\nend', true);
        expect(state.outputs.get(5)).toEqual([{ text: 'Total = 6 · 3 iterations', error: false }]);
    } finally {
        session.dispose();
    }
});

it('reports a block-scope error without the generated program line numbers', async () => {
    const outputs = await previewFunction('f', [], [],
        ['fun f', '  for I in 1 to 2', '    X = I', '  end', '  X'].join('\n'));
    const errors = [...outputs.values()].flat().filter(line => line.error);
    expect(errors.length).toBeGreaterThan(0);
    for (const line of errors) {
        expect(line.text).not.toMatch(/at line \d+/);
        expect(line.text).not.toContain('[Syntax]');
    }
});
