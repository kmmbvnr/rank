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

test('clicks use wrapped Unicode positions and copy view leaves the cursor alone', t => {
    const { repl, renderer, writes } = setup(t);
    repl.notebook.replace('界'.repeat(40));
    renderer.render();
    renderer.click(10, 1);
    assert.equal(repl.notebook.cursor, 38);
    renderer.copyKey({ sequence: '\x08' });
    renderer.render();
    assert.match(writes.at(-1), /\x1b\[\?1000l/);
    renderer.click(6, 0);
    assert.equal(repl.notebook.cursor, 38);
});

test('mouse dragging selects source across cells while skipping rendered output', async t => {
    const { repl, renderer, writes } = setup(t);
    repl.notebook.replace('A = 1');
    await repl.submit();
    repl.notebook.replace('A + 2');
    await repl.submit();
    renderer.render();
    renderer.click(6, 0);
    renderer.drag(11, 2, false);
    assert.equal(repl.notebook.selectedText, 'A = 1\nA + 2');
    assert.match(writes.at(-1), /\x1b\[7m/);
    renderer.drag(11, 2, true);
    renderer.drag(6, 4, false);
    assert.equal(repl.notebook.selectedText, 'A = 1\nA + 2');
    renderer.click(6, 4);
    assert.equal(repl.notebook.selection, undefined);
});

test('copy view scrolls through source and excludes command cells', t => {
    const { repl, renderer, writes } = setup(t);
    repl.notebook.enqueue('help');
    repl.notebook.cells[0].command = true;
    repl.notebook.replace(Array.from({ length: 45 }, (_, i) => `A${i} = ${i}`).join('\n'));
    renderer.copyKey({ sequence: '\x08' });
    renderer.render();
    assert.match(writes.at(-1), /A0 = 0/);
    assert.doesNotMatch(writes.at(-1), /help|rank>|Ctrl-/);
    renderer.copyKey({ name: 'pagedown' });
    renderer.render();
    assert.match(writes.at(-1), /A20 = 20/);
    assert.doesNotMatch(writes.at(-1), /A0 = 0/);
    renderer.copyKey({ name: 'end' });
    renderer.render();
    assert.match(writes.at(-1), /A44 = 44/);
    renderer.copyKey({ name: 'home' });
    renderer.copyKey({ name: 'up' });
    renderer.render();
    assert.match(writes.at(-1), /A0 = 0/);
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

test('wheel scrolls the viewport and typing resumes following the unchanged cursor', t => {
    const { repl, renderer, writes } = setup(t);
    repl.notebook.replace(Array.from({ length: 45 }, (_, i) => `A${i} = ${i}`).join('\n'));
    const cursor = repl.notebook.cursor;
    renderer.render();
    assert.doesNotMatch(writes.at(-1), /A0 = 0/);
    for (let i = 0; i < 20; i++) renderer.scroll(-1);
    assert.match(writes.at(-1), /A0 = 0/);
    renderer.scroll(1);
    assert.doesNotMatch(writes.at(-1), /A0 = 0/);
    assert.match(writes.at(-1), /A3 = 3/);
    assert.equal(repl.notebook.cursor, cursor);
    renderer.followKey('a');
    renderer.render();
    assert.match(writes.at(-1), /A44 = 44/);
});

test('Ctrl-R anchors the screen cursor when examples appear and typing keeps that viewport', async t => {
    const session = createReplSession();
    t.after(() => session.dispose());
    const repl = new NotebookRepl(session, undefined, undefined, true);
    const writes = [];
    const renderer = new TerminalRenderer(repl, new TerminalModeRouter(repl),
        { columns: 80, rows: 20, write: text => writes.push(text) });
    const book = repl.notebook;
    book.replace('fun inc X'); await repl.submit();
    repl.exampleEditor.replace('2'); await repl.submit();
    book.insert('Result = X + 1'); await repl.submit();
    book.insert('end'); await repl.submit();
    book.active = 0;
    book.cursor = book.current.source.indexOf('\nend');
    renderer.render();
    const caret = () => [...writes.at(-1).matchAll(/\x1b\[(\d+);(\d+)H/g)].at(-1)[1];
    const row = caret();
    renderer.followKey('r', true);
    await repl.rerun();
    renderer.render();
    assert.equal(caret(), row);
    assert.match(writes.at(-1), /X = 2/);
    renderer.followKey('space');
    book.insert(' ');
    renderer.render();
    assert.equal(caret(), row);
});
