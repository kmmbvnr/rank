import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyRouter } from '../out/key-router.js';
import { NotebookRepl } from '../out/repl.js';
import { createReplSession } from '../out/repl-session.js';
import { notebookFrame } from '../out/screen.js';

const clean = text => text.replace(/\x1b\[[0-9;]*m/g, '');

/** A fast keyboard-level driver for state transitions; representative paths also run through the real PTY tests. */
function scenario() {
    const session = createReplSession();
    const repl = new NotebookRepl(session, undefined, undefined, true);
    const router = new KeyRouter(repl, [], () => 80);
    const book = repl.notebook;
    const trace = [];

    const check = label => {
        trace.push(label);
        assert.ok(book.cells.length > 0, trace.join(' -> '));
        assert.ok(book.active >= 0 && book.active < book.cells.length, trace.join(' -> '));
        assert.ok(book.cursor >= 0 && book.cursor <= book.current.source.length, trace.join(' -> '));
        assert.equal(new Set(book.cells.map(cell => cell.id)).size, book.cells.length, trace.join(' -> '));
        for (const line of repl.liveOutputs?.keys() ?? []) {
            assert.ok(line >= 1 && line <= book.current.source.split('\n').length, trace.join(' -> '));
        }
        if (repl.examplePrompt) {
            const editor = repl.exampleEditor;
            assert.ok(editor.cursor >= 0 && editor.cursor <= editor.current.source.length, trace.join(' -> '));
            assert.equal(repl.exampleFields.filter(field => field.active).length, 1, trace.join(' -> '));
            const frame = notebookFrame(book, 80, 40, 0, repl.suggestion, false, true, '', 'Running…',
                undefined, repl.promptLabel, repl.liveOutputs, repl.exampleFields, repl.liveIterationFocus);
            assert.match(clean(frame.lines[frame.cursor.row]),
                new RegExp(`^\\s*${repl.examplePrompt.parameter} =`), trace.join(' -> '));
        }
    };
    const key = async (text, key, label) => { await router.press(text, key); check(label); };
    const type = text => key(text, {}, `type ${JSON.stringify(text)}`);
    const clear = () => key('', { ctrl: true, name: 'u' }, 'Ctrl-U');
    const backspace = () => key('', { name: 'backspace' }, 'Backspace');
    const enter = () => key('\r', { name: 'return' }, 'Enter');
    const ctrlR = () => key('\x12', { ctrl: true, name: 'r' }, 'Ctrl-R');
    const up = () => key('', { name: 'up' }, 'Up');
    const down = () => key('', { name: 'down' }, 'Down');
    const left = () => key('', { name: 'left' }, 'Left');
    const right = () => key('', { name: 'right' }, 'Right');

    return { session, repl, book, trace, type, clear, backspace, enter, ctrlR, up, down, left, right };
}

test('Ctrl-L resets retained state, runs the entire document and clears orange provenance', async () => {
    const s = scenario();
    try {
        for (const source of ['Count = 0', 'Count += 1', 'Count']) {
            await s.type(source);
            await s.enter();
        }
        s.book.replayFrom = 1;
        await s.enter();
        assert.equal(s.book.cells[2].output[0].text, '2');
        assert.equal(s.book.isExperimental(2), true);
        s.book.active = 1;
        const router = new KeyRouter(s.repl);
        await router.press('\x0c', { ctrl: true, name: 'l' });
        assert.equal(s.book.cells[2].output[0].text, '1');
        assert.equal(s.book.isExperimental(2), false);
        assert.ok(s.book.cells.slice(0, -1).every(cell => cell.status === 'ok'));
        await s.type('Count + 10');
        await router.press('\x0c', { ctrl: true, name: 'l' });
        assert.equal(s.book.cells.at(-2).output[0].text, '11');
        assert.equal(s.book.current.source, '');
    } finally { s.session.dispose(); }
});

test('Ctrl-L preserves an unfinished live draft and stops at errors above it', async () => {
    const s = scenario();
    try {
        await s.type('A = 1');
        await s.enter();
        await s.type('fun example');
        await s.enter();
        await s.type('B = A + 1');
        await s.enter();
        const draft = s.book.current.source;
        await new KeyRouter(s.repl).press('\x0c', { ctrl: true, name: 'l' });
        assert.equal(s.book.current.source, draft);
        assert.equal(s.repl.liveEditing, true);
        assert.equal(s.repl.liveOutputs.size, 0);
        s.book.active = 0;
        s.book.replace('A = Missing');
        await s.repl.restart();
        assert.equal(s.book.cells[0].status, 'error');
        assert.equal(s.book.cells.at(-1).source, draft);
    } finally { s.session.dispose(); }
});

test('an unfinished loop survives adding an import above it and resumes after replay', async () => {
    const s = scenario();
    try {
        for (const source of ['use numbers', 'use io', 'Threshold = 1000000', 'Answer = 0']) {
            await s.type(source);
            await s.enter();
        }
        await s.type('for N in 1 to 100');
        await s.enter();
        await s.enter(); // leave the iteration selector
        await s.type('K = 0 to N');
        await s.enter();
        const draft = s.book.current.source;
        while (s.book.active > 1) await s.up();
        assert.equal(s.repl.liveEditing, false);
        assert.equal(s.repl.liveOutputs, undefined);
        s.book.lineEdge(true);
        await s.enter();
        await s.type('use sequences');
        assert.equal(s.book.cells.at(-1).source, draft);
        await s.ctrlR();
        assert.equal(s.book.cells.at(-1).source, draft);
        assert.equal(s.book.cells[1].status, 'ok');
        s.book.toPrompt();
        assert.equal(s.repl.liveEditing, true);
        if (s.repl.liveIterationFocused) await s.enter();
        await s.type('Choices = N K binomial');
        await s.enter();
        assert.ok(s.book.current.source.includes('Choices = N K binomial'));
        assert.ok(s.book.current.source.startsWith('for N in 1 to 100\n'));
    } finally { s.session.dispose(); }
});

test('an unfinished function is suspended while editing an earlier instruction', async () => {
    const s = scenario();
    try {
        await s.type('A = 1');
        await s.enter();
        await s.type('fun example');
        await s.enter();
        await s.type('B = A + 1');
        await s.enter();
        const draft = s.book.current.source;
        while (s.book.active > 0) await s.up();
        assert.equal(s.repl.liveEditing, false);
        s.book.lineEdge(true);
        await s.enter();
        await s.type('C = 2');
        await s.ctrlR();
        assert.equal(s.book.cells.at(-1).source, draft);
        assert.equal(s.repl.liveEditing, true);
        await s.type('return B');
        await s.enter();
        assert.ok(s.book.current.source.includes('return B'));
    } finally { s.session.dispose(); }
});

test('generated live-function editing scenarios recover from likely user mistakes', async () => {
    let cases = 0;
    for (const headerTypo of [false, true]) {
        for (const argumentTypo of [false, true]) {
            for (const bodyTypo of [false, true]) {
                for (const selected of ['header', 'first body line', 'second body line']) {
                    for (const replacement of ['2', '5']) {
                        const s = scenario();
                        try {
                            await s.type(headerTypo ? 'func inc X' : 'fun inc X');
                            await s.enter();
                            if (headerTypo) {
                                assert.match(s.book.current.output.map(line => line.text).join('\n'), /unknown name: func/);
                                await s.clear();
                                await s.type('fun inc X');
                                await s.enter();
                            }

                            if (argumentTypo) {
                                await s.type('A = 1');
                                await s.enter();
                                assert.ok(s.repl.examplePrompt, s.trace.join(' -> '));
                                assert.match(s.repl.exampleFields[0].error, /Syntax/);
                                await s.clear();
                            }
                            await s.type('1');
                            await s.enter();

                            await s.type(bodyTypo ? 'Result = X + )' : 'Result = X + 1');
                            await s.enter();
                            if (bodyTypo) {
                                assert.ok(s.repl.liveOutputs.get(2).some(line => line.error), s.trace.join(' -> '));
                                await s.backspace();
                                await s.type('1');
                                await s.enter();
                            }
                            await s.type('Result *= 2');
                            await s.enter();
                            await s.type('end');
                            await s.enter();
                            assert.equal(s.repl.liveEditing, false, s.trace.join(' -> '));

                            await s.up(); // prompt -> outer end
                            const extraUps = selected === 'header' ? 3 : selected === 'first body line' ? 2 : 1;
                            for (let index = 0; index < extraUps; index++) await s.up();
                            await s.ctrlR();
                            assert.ok(s.repl.examplePrompt, s.trace.join(' -> '));
                            await s.clear();
                            await s.type(replacement);
                            await s.enter();

                            const selectedLine = selected === 'second body line' ? 3 : 2;
                            const cursorLine = s.book.current.source.slice(0, s.book.cursor).split('\n').length;
                            assert.equal(cursorLine, selectedLine, s.trace.join(' -> '));
                            assert.equal(s.repl.liveOutputs.has(selectedLine), false, s.trace.join(' -> '));
                            if (selectedLine === 3) assert.equal(s.repl.liveOutputs.has(2), true, s.trace.join(' -> '));

                            await s.enter();
                            assert.ok(s.repl.liveOutputs.get(selectedLine)?.every(line => !line.error), s.trace.join(' -> '));
                            for (let guard = 0; s.repl.liveEditing && guard < 4; guard++) await s.enter();
                            assert.equal(s.repl.liveEditing, false, s.trace.join(' -> '));
                            assert.equal(s.book.cells[0].status, 'ok', s.trace.join(' -> '));
                            cases++;
                        } catch (error) {
                            error.message += `\nscenario: ${s.trace.join(' -> ')}`;
                            throw error;
                        } finally { s.session.dispose(); }
                    }
                }
            }
        }
    }
    assert.equal(cases, 48);
});

test('real key routing edits all argument fields and returns from the body to them', async () => {
    const s = scenario();
    try {
        await s.type('fun add X Y');
        await s.enter();
        await s.type('1');
        await s.down();
        await s.type('2');
        await s.up();
        await s.clear();
        await s.type('3');
        await s.down();
        assert.deepEqual(s.repl.exampleFields.map(field => [field.name, field.source, field.active]), [
            ['X', '3', false], ['Y', '2', true],
        ]);
        await s.enter();
        assert.equal(s.repl.examplePrompt, undefined);
        await s.type('return X + Y');
        await s.enter();
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['5']);

        await s.up(); // empty line -> first body line
        await s.up(); // first body line -> last argument field
        assert.equal(s.repl.examplePrompt.parameter, 'Y');
        await s.clear();
        await s.type('4');
        await s.enter();
        assert.equal(s.repl.liveOutputs.has(2), false, 'selected body line waits for Enter');
        await s.enter();
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['7']);
    } finally { s.session.dispose(); }
});

test('Up above the first unfinished block inserts an import without losing live editing', async () => {
    for (const header of ['for i in 1 to 10', 'fun example']) {
        const s = scenario();
        try {
            await s.type(header);
            await s.enter();
            if (s.repl.liveIterationFocused) await s.enter();
            await s.type('(array 1) count');
            const draft = s.book.current.source;
            const draftId = s.book.current.id;
            for (let guard = 0; guard < 5 && s.book.cells.length === 1; guard++) await s.up();
            assert.equal(s.book.cells.length, 2);
            assert.equal(s.book.active, 0);
            assert.equal(s.book.current.source, '');
            assert.equal(s.repl.liveEditing, false);
            await s.up();
            assert.equal(s.book.cells.length, 2, 'Up on the blank insertion row does not add more rows');
            await s.type('use sequences');
            await s.ctrlR();
            assert.equal(s.book.cells[0].status, 'ok');
            assert.equal(s.book.current.id, draftId);
            assert.equal(s.book.current.source, draft);
            assert.equal(s.repl.liveEditing, true);
            await s.enter();
            const errors = [...s.repl.liveOutputs.values()].flat().filter(line => line.error);
            assert.ok(errors.some(line => line.text.includes('count expects boolean values')));
            assert.ok(errors.every(line => !line.text.includes('unknown name: count')));
            assert.equal(s.book.cells.at(-1).id, draftId);
        } finally { s.session.dispose(); }
    }
});

test('Up leaves the iteration field through the loop header without losing the draft', async () => {
    const s = scenario();
    try {
        await s.type('use sequences');
        await s.enter();
        await s.type('for i in 1 to 10');
        await s.enter();
        await s.enter();
        await s.type('(array i) count');
        const draft = s.book.current.source;
        await s.up();
        assert.equal(s.repl.liveIterationFocused, true);
        await s.up();
        assert.equal(s.repl.liveIterationFocused, false);
        assert.equal(s.book.cursor, 'for i in 1 to 10'.length);
        await s.up();
        assert.equal(s.book.active, 0);
        assert.equal(s.repl.liveEditing, false);
        assert.equal(s.book.cells.at(-1).source, draft);
        assert.equal(s.book.cells.at(-1).output.length, 0);
    } finally { s.session.dispose(); }
});

test('arrow keys select a function loop iteration without evaluating its body', async () => {
    const s = scenario();
    try {
        await s.type('fun total N');
        await s.enter();
        await s.type('3');
        await s.enter();
        await s.type('Sum = 0');
        await s.enter();
        await s.type('for I in 1 to N');
        await s.enter();
        assert.equal(s.repl.liveIterationFocused, true);
        await s.enter();
        assert.equal(s.repl.liveIterationFocused, false);
        await s.type('Sum += I');
        await s.enter();
        assert.deepEqual(s.repl.liveOutputs.get(4).map(line => line.text), ['1']);

        const source = s.book.current.source;
        await s.up();
        await s.up();
        assert.equal(s.repl.liveIterationFocused, true);
        await s.right();
        assert.equal(s.book.current.source, source);
        assert.deepEqual(s.repl.liveOutputs.get(3).map(line => line.text), ['I = 2 · iteration 2']);
        assert.equal(s.repl.liveOutputs.has(4), false);
        assert.match(s.repl.suggestion, /iteration 2 · ←\/→ select · Enter body/);
        const focused = notebookFrame(s.book, 80, 20, 0, s.repl.suggestion, false, true, '', 'Running…',
            undefined, s.repl.promptLabel, s.repl.liveOutputs, s.repl.exampleFields, s.repl.liveIterationFocus);
        assert.match(clean(focused.lines[focused.cursor.row]), /I = 2 · iteration 2/);

        await s.enter();
        assert.equal(s.repl.liveIterationFocused, false);
        await s.enter();
        assert.deepEqual(s.repl.liveOutputs.get(3).map(line => line.text), ['I = 2 · iteration 2']);
        assert.deepEqual(s.repl.liveOutputs.get(4).map(line => line.text), ['3']);
        assert.equal(s.book.current.source, source);

        await s.up();
        await s.up();
        await s.left();
        assert.deepEqual(s.repl.liveOutputs.get(3).map(line => line.text), ['I = 1 · iteration 1']);
        assert.equal(s.repl.liveOutputs.has(4), false);
        await s.enter();
        await s.enter();
        assert.deepEqual(s.repl.liveOutputs.get(4).map(line => line.text), ['1']);

        s.book.insert('X', true);
        const cursor = s.book.cursor;
        await s.left();
        assert.equal(s.book.cursor, cursor - 1, 'arrows keep editing a non-empty line');
    } finally { s.session.dispose(); }
});

test('Ctrl-R on loop end makes arrows reevaluate its body', async () => {
    const s = scenario();
    try {
        await s.type('for I in 1 to 3');
        await s.enter();
        await s.enter();
        await s.type('Value = I * 2');
        await s.enter();
        await s.type('end');
        await s.enter();
        assert.equal(s.repl.liveEditing, false);

        await s.up();
        await s.ctrlR();
        assert.equal(s.repl.liveIterationFocused, true);
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['2']);
        await s.right();
        assert.deepEqual(s.repl.liveOutputs.get(1).map(line => line.text), ['I = 2 · iteration 2']);
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['4']);
    } finally { s.session.dispose(); }
});
