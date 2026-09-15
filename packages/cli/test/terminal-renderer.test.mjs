import assert from 'node:assert/strict';
import test from 'node:test';
import { NotebookRepl } from '../out/repl.js';
import { createReplSession } from '../out/repl-session.js';
import { TerminalModeRouter } from '../out/terminal-modes.js';
import { TerminalRenderer } from '../out/terminal-renderer.js';

function setup(t) {
    const session = createReplSession();
    t.after(() => session.dispose());
    const repl = new NotebookRepl(session);
    const modes = new TerminalModeRouter(repl);
    const writes = [];
    const output = { columns: 80, rows: 20, write: text => writes.push(text) };
    const renderer = new TerminalRenderer(repl, modes, output);
    return { repl, modes, renderer, writes };
}

test('terminal renderer selects notebook, help and save frames', async t => {
    const { repl, renderer, writes } = setup(t);
    renderer.render();
    assert.match(writes.at(-1), /rank> /);

    repl.help = { text: 'Editing\nHelp body', top: 0 };
    renderer.render();
    assert.match(writes.at(-1), /Help body/);
    assert.doesNotMatch(writes.at(-1), /rank> /);

    repl.help = undefined;
    await repl.requestSave();
    renderer.render();
    assert.match(writes.at(-1), /Save program/);
});

test('terminal renderer honors the render gate and suppresses writes after close', t => {
    const { renderer, modes, writes } = setup(t);
    const original = modes.allowRender.bind(modes);
    modes.allowRender = () => false;
    renderer.render();
    assert.equal(writes.length, 0);
    modes.allowRender = original;
    renderer.render();
    assert.equal(writes.length, 1);
    renderer.close();
    renderer.render();
    assert.equal(writes.length, 1);
    assert.equal(renderer.closed, true);
});

test('terminal renderer keeps the paused screen with a running footer while advancing', async () => {
    let pauseState = { source: 'for\nend', line: 1, activity: 'before line 1', state: 'Variables:\n  N = 1' };
    const repl = {
        running: true, pauseTop: 0, savePrompt: undefined, help: undefined,
        session: {
            get pauseState() { return pauseState; },
            stepToMain() { pauseState = undefined; },
        },
        get pauseSnapshot() { return pauseState; },
        runningStatus: 'Running… 1.2s · ^C stop · ^P pause',
    };
    const modes = new TerminalModeRouter(repl);
    const writes = [];
    const renderer = new TerminalRenderer(repl, modes, { columns: 80, rows: 20, write: text => writes.push(text) });
    renderer.render();
    await modes.press('g', { name: 'g' });
    renderer.render();
    assert.match(writes.at(-1), /Paused · before line 1/);
    assert.match(writes.at(-1), /Running… 1\.2s · \^C stop · \^P pause/);
    assert.doesNotMatch(writes.at(-1), /rank> /);
});
