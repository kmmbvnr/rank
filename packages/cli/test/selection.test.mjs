import assert from 'node:assert/strict';
import test from 'node:test';
import { Notebook } from '../out/notebook.js';
import { NotebookRepl } from '../out/repl.js';
import { KeyRouter } from '../out/key-router.js';
import { createReplSession } from '../out/repl-session.js';
import { notebookFrame } from '../out/screen.js';
import { systemClipboard } from '../out/clipboard.js';

function setup(t) {
    const session = createReplSession();
    t.after(() => session.dispose());
    const repl = new NotebookRepl(session, undefined, undefined, true);
    let text = '';
    const clipboard = { read: async () => text, write: async value => { text = value; } };
    const router = new KeyRouter(repl, [], () => 80, clipboard);
    const key = (name, modifiers = {}) => router.press('', { name, ...modifiers });
    return { repl, book: repl.notebook, clipboard, router, key,
        shift: name => key(name, { shift: true }), ctrl: name => key(name, { ctrl: true }) };
}

test('Shift selects graphemes, typing replaces the selection and undo restores it', () => {
    const book = new Notebook();
    book.replace('A界👩‍💻');
    book.selectMove('left', 20);
    assert.equal(book.selectedText, '👩‍💻');
    book.selectMove('left', 20);
    assert.equal(book.selectedText, '界👩‍💻');
    book.insert('B', true);
    assert.equal(book.current.source, 'AB');
    assert.equal(book.selection, undefined);
    book.undo();
    assert.equal(book.current.source, 'A界👩‍💻');
    book.undo(true);
    assert.equal(book.current.source, 'AB');
});

test('selection spans cells, excludes commands and supports cross-cell deletion undo and redo', () => {
    const book = new Notebook();
    book.enqueue('A = 1');
    book.enqueue('help');
    book.cells[1].command = true;
    book.enqueue('B = 2');
    book.active = 0;
    book.cursor = 0;
    book.selectMove('end', 80);
    book.selectMove('right', 80);
    book.selectMove('end', 80);
    assert.equal(book.selectedText, 'A = 1\nB = 2');
    book.erase(true);
    assert.equal(book.cells.length, 2);
    assert.equal(book.current.source, '');
    book.undo();
    assert.deepEqual(book.cells.map(cell => cell.source), ['A = 1', 'help', 'B = 2', '']);
    book.undo(true);
    assert.deepEqual(book.cells.map(cell => cell.source), ['', '']);
    assert.equal(book.dirtyFrom, 0);
});

test('deleting through the draft preserves a separate prompt and restores it on undo', () => {
    const book = new Notebook();
    book.enqueue('A = 1');
    book.replace('B = 2');
    book.selectMove('home', 80);
    book.selectMove('left', 80);
    book.selectMove('home', 80);
    book.insert('C = 3');
    assert.deepEqual(book.cells.map(cell => cell.source), ['C = 3', '']);
    book.undo();
    assert.deepEqual(book.cells.map(cell => cell.source), ['A = 1', 'B = 2']);
});

test('Shift navigation copies source, cuts, pastes without execution and preserves Ctrl-C without selection', async t => {
    const { book, shift, ctrl, clipboard, repl } = setup(t);
    book.replace('1 + 2\n3 + 4');
    await shift('home');
    await ctrl('c');
    assert.equal(await clipboard.read(), '3 + 4');
    assert.equal(book.current.source, '1 + 2\n3 + 4');
    await ctrl('x');
    assert.equal(book.current.source, '1 + 2\n');
    await ctrl('v');
    assert.equal(book.current.source, '1 + 2\n3 + 4');
    assert.equal(book.cells.length, 1);
    assert.equal(repl.running, false);
    await ctrl('c');
    assert.equal(book.current.source, '');
});

test('clipboard errors preserve selected text and report an actionable message', async t => {
    const { book, repl, shift } = setup(t);
    book.replace('important');
    await shift('home');
    const failed = async () => { throw new Error('no clipboard'); };
    const router = new KeyRouter(repl, [], () => 80, { read: failed, write: failed });
    for (const name of ['x', 'v']) {
        await router.press('', { ctrl: true, name });
        assert.equal(book.current.source, 'important');
        assert.equal(book.selectedText, 'important');
        assert.match(repl.suggestion, /Clipboard unavailable/);
    }
});

test('typing during a delayed clipboard read stays after the pasted text', async t => {
    const { repl, book } = setup(t);
    let resolve;
    const clipboard = { read: () => new Promise(done => { resolve = done; }), write: async () => {} };
    const router = new KeyRouter(repl, [], () => 80, clipboard);
    const paste = router.press('', { name: 'v', ctrl: true });
    const typing = router.press('B', {});
    resolve('A');
    await Promise.all([paste, typing]);
    assert.equal(book.current.source, 'AB');
});

test('plain arrows collapse selection and Esc clears it without discarding the draft', async t => {
    const { book, shift, key, router } = setup(t);
    book.replace('abcd');
    await shift('left');
    await shift('left');
    await key('left');
    assert.equal(book.cursor, 2);
    assert.equal(book.selection, undefined);
    await shift('left');
    await key('escape');
    assert.equal(book.current.source, 'abcd');
    assert.equal(book.selection, undefined);
    await shift('right');
    await key('return');
    assert.equal(book.current.source, 'a\ncd');
    assert.equal(book.cells.length, 1);
    await router.press('Z', {});
    assert.equal(book.current.source, 'a\nZcd');
});

test('selection follows wrapped rows and paints only selected source characters', () => {
    const book = new Notebook();
    book.replace('abcdef界gh');
    book.selectMove('up', 6);
    const selected = book.selectedText;
    assert.ok(selected.length > 0);
    const frame = notebookFrame(book, 13, 12);
    assert.match(frame.lines.join('\n'), /\x1b\[7m/);
    assert.doesNotMatch(frame.lines[0], /\x1b\[7mrank>/);
    assert.equal(frame.lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '').includes('abcdef'), true);
});

test('example fields support selection, replacement and clipboard without editing function source', async t => {
    const { router, repl, book, shift, ctrl, clipboard, key } = setup(t);
    await router.press('fun inc N', {});
    await key('return');
    await router.press('123', {});
    await shift('home');
    await ctrl('c');
    assert.equal(await clipboard.read(), '123');
    const frame = notebookFrame(book, 80, 20, 0, '', false, true, '', '',
        undefined, repl.promptLabel, repl.liveOutputs, repl.exampleFields);
    assert.match(frame.lines.join('\n'), /\x1b\[7m1/);
    await router.press('4', {});
    assert.equal(repl.exampleEditor.current.source, '4');
    assert.equal(book.current.source, 'fun inc N');
});

test('cutting across an unfinished function does not leave its example controller stuck', async t => {
    const { router, repl, book, key, ctrl } = setup(t);
    await router.press('A = 1', {});
    await key('return');
    await router.press('fun old N', {});
    await key('return');
    await router.press('3', {});
    await key('return');
    book.selectTo(0, 0);
    book.selectTo(1, book.cells[1].source.length, true);
    await ctrl('x');
    book.toPrompt();
    await router.press('fun fresh N', {});
    await key('return');
    assert.equal(repl.examplePrompt.name, 'fresh');
});

test('system clipboard sends arbitrary text through stdin and returns exact pasted text', async () => {
    const calls = [];
    const run = async (...args) => { calls.push(args); return 'hello\n'; };
    const clipboard = systemClipboard('darwin', {}, run);
    await clipboard.write('$(touch nope) `nope`\n界');
    assert.deepEqual(calls[0], ['pbcopy', [], '$(touch nope) `nope`\n界']);
    assert.equal(await clipboard.read(), 'hello\n');
    assert.deepEqual(calls[1], ['pbpaste', []]);
});
