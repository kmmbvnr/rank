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

    return { session, repl, book, trace, type, clear, backspace, enter, ctrlR, up, down, left, right,
        ctrlG: () => key('', { ctrl: true, name: 'g' }, 'Ctrl-G'),
        ctrlT: () => key('', { ctrl: true, name: 't' }, 'Ctrl-T'),
        esc: () => key('', { name: 'escape' }, 'Esc') };
}

for (const trailingBlank of [false, true]) {
    test(`Enter after the outer end finishes a new function after Ctrl-R (trailing blank: ${trailingBlank})`, async () => {
        const s = scenario();
        try {
            await s.type('fun digit_sum N');
            await s.enter();
            await s.type('"123456"');
            await s.enter();
            await s.type('Digits = N text integer rank 0');
            await s.ctrlR();
            await s.enter();
            await s.type('return Digits sum');
            await s.enter();
            await s.type(trailingBlank ? 'end\n  ' : 'end');
            await s.enter();
            assert.equal(s.repl.liveEditing, false);
            assert.equal(s.repl.advancing, false);
            assert.equal(s.book.current.source, '');
            assert.equal(s.book.cells[0].status, 'ok');
            await s.type('123456 digit_sum');
            await s.enter();
            assert.equal(s.book.cells.at(-2).output[0].text, '21');
        } finally { s.session.dispose(); }
    });
}

test('Enter after a nested end keeps a new function open after Ctrl-R', async () => {
    const s = scenario();
    try {
        await s.type('fun identity N');
        await s.enter();
        await s.type('3');
        await s.enter();
        await s.type('if N greater 0');
        await s.ctrlR();
        await s.enter();
        await s.type('return N');
        await s.enter();
        await s.type('end');
        await s.enter();
        assert.equal(s.repl.liveEditing, true);
        assert.equal(s.book.cells.length, 1);
        await s.type('end');
        await s.enter();
        assert.equal(s.repl.liveEditing, false);
        assert.equal(s.book.current.source, '');
    } finally { s.session.dispose(); }
});

for (const selectIteration of [false, true]) {
    test(`a for inside a new function closes separately from the function (select iteration: ${selectIteration})`, async () => {
        const s = scenario();
        try {
            await s.type('fun total N');
            await s.enter();
            await s.type('3');
            await s.enter();
            await s.type('Sum = 0');
            await s.enter();
            await s.type('for I in 1 to N');
            if (selectIteration) {
                await s.ctrlR();
                assert.equal(s.repl.liveIterationFocused, true);
                await s.right();
                assert.match(s.repl.liveOutputs.get(3)[0].text, /I = 2/);
                await s.enter();
                assert.equal(s.repl.liveIterationFocused, false);
            }
            await s.enter();
            await s.type('Sum += I');
            await s.enter();
            await s.type('end');
            await s.enter();
            assert.equal(s.repl.liveEditing, true);
            assert.equal(s.book.cells.length, 1);
            await s.type('return Sum');
            await s.enter();
            await s.type('end');
            await s.enter();
            assert.equal(s.repl.liveEditing, false);
            assert.equal(s.repl.liveIterationFocused, false);
            assert.equal(s.book.current.source, '');
            await s.type('3 total');
            await s.enter();
            assert.equal(s.book.cells.at(-2).output[0].text, '6');
        } finally { s.session.dispose(); }
    });
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
                                await s.ctrlT();
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
                            await s.ctrlT();
                            assert.ok(s.repl.examplePrompt, s.trace.join(' -> '));
                            await s.clear();
                            await s.type(replacement);
                            await s.enter();

                            const selectedLine = selected === 'second body line' ? 3 : 2;
                            const cursorLine = s.book.current.source.slice(0, s.book.cursor).split('\n').length;
                            assert.equal(cursorLine, selectedLine, s.trace.join(' -> '));
                            assert.equal(s.repl.liveOutputs.has(selectedLine), false, s.trace.join(' -> '));
                            if (selectedLine === 3) assert.equal(s.repl.liveOutputs.has(2), true, s.trace.join(' -> '));

                            await s.ctrlR();
                            assert.ok(s.repl.liveOutputs.get(selectedLine)?.every(line => !line.error), s.trace.join(' -> '));
                            for (let guard = 0; s.repl.liveEditing && guard < 4; guard++) await s.ctrlR();
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
        await s.ctrlR();
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['5']);

        await s.ctrlT(); // arguments are opened explicitly, not by an arrow key
        await s.down();
        assert.equal(s.repl.examplePrompt.parameter, 'Y');
        await s.clear();
        await s.type('4');
        await s.enter();
        assert.equal(s.repl.liveOutputs.has(2), false, 'selected body line waits for Enter');
        await s.ctrlR();
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
        await s.type('(array i) count');
        const draft = s.book.current.source;
        await s.up();
        assert.equal(s.repl.liveIterationFocused, true);
        assert.equal(s.repl.iterationSelecting, false);
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
        assert.equal(s.repl.liveIterationFocused, false);
        await s.type('Sum += I');
        await s.enter();
        assert.deepEqual(s.repl.liveOutputs.get(4).map(line => line.text), ['1']);

        const source = s.book.current.source;
        await s.up();
        await s.up();
        assert.equal(s.repl.liveIterationFocused, true);
        await s.right();
        assert.deepEqual(s.repl.liveOutputs.get(3).map(line => line.text), ['I = 1 · iteration 1']);
        await s.enter();
        await s.right();
        assert.equal(s.book.current.source, source);
        assert.deepEqual(s.repl.liveOutputs.get(3).map(line => line.text), ['I = 2 · iteration 2']);
        assert.equal(s.repl.liveOutputs.has(4), false);
        assert.equal(s.repl.suggestion, '←/→ select · Esc edit · ^L run all');
        const focused = notebookFrame(s.book, 80, 20, 0, s.repl.suggestion, false, true, '', 'Running…',
            undefined, s.repl.promptLabel, s.repl.liveOutputs, s.repl.exampleFields, s.repl.liveIterationFocus);
        assert.match(clean(focused.lines[focused.cursor.row]), /I = 2 · iteration 2/);

        await s.enter();
        assert.equal(s.repl.liveIterationFocused, false);
        await s.ctrlR();
        assert.deepEqual(s.repl.liveOutputs.get(3).map(line => line.text), ['I = 2 · iteration 2']);
        assert.deepEqual(s.repl.liveOutputs.get(4).map(line => line.text), ['3']);
        assert.equal(s.book.current.source, source);

        await s.up();
        await s.up();
        await s.enter();
        await s.left();
        assert.deepEqual(s.repl.liveOutputs.get(3).map(line => line.text), ['I = 1 · iteration 1']);
        assert.equal(s.repl.liveOutputs.has(4), false);
        await s.enter();
        await s.ctrlR();
        assert.deepEqual(s.repl.liveOutputs.get(4).map(line => line.text), ['1']);

        s.book.insert('X', true);
        const cursor = s.book.cursor;
        await s.left();
        assert.equal(s.book.cursor, cursor - 1, 'arrows keep editing a non-empty line');
    } finally { s.session.dispose(); }
});

test('Up traverses wrapped body rows before reaching the passive iteration row', async () => {
    const s = scenario();
    try {
        await s.type('for I in 1 to 3');
        await s.enter();
        await s.type('Value = ' + 'I + '.repeat(20) + 'I');
        const router = new KeyRouter(s.repl, [], () => 40);
        const source = s.book.current.source;
        await router.press('', { name: 'up' });
        assert.equal(s.repl.liveIterationFocused, false);
        for (let index = 0; index < 5 && !s.repl.liveIterationFocused; index++)
            await router.press('', { name: 'up' });
        assert.equal(s.repl.liveIterationFocused, true);
        assert.equal(s.repl.iterationSelecting, false);
        await router.press('', { name: 'up' });
        assert.equal(s.book.cursor, 'for I in 1 to 3'.length);
        await router.press('', { name: 'down' });
        assert.equal(s.repl.liveIterationFocused, true);
        assert.equal(s.repl.iterationSelecting, false);
        await router.press('', { name: 'down' });
        assert.equal(s.repl.liveIterationFocused, false);
        assert.equal(s.book.current.source, source);
    } finally { s.session.dispose(); }
});

test('Ctrl-R on the first source resets state but runs only one instruction; Ctrl-R continues green', async () => {
    const s = scenario();
    try {
        for (const line of ['Count = 0', 'Count += 1', 'Count']) { await s.type(line); await s.enter(); }
        await s.session.execute('Stray = 42', 1000, []);
        s.book.active = 1;
        s.book.cursor = s.book.current.source.length;
        await s.ctrlR();
        assert.equal(s.book.isExperimental(1), true);
        s.book.active = 0;
        s.book.cursor = 0;
        await s.ctrlR();
        assert.equal(s.book.active, 1);
        assert.equal(s.book.cells[1].executed, undefined);
        assert.equal(s.book.isExperimental(0), false);
        const stray = await s.session.execute('Stray', 1001, []);
        assert.equal(stray.ok, false);
        await s.ctrlR();
        await s.ctrlR();
        assert.deepEqual(s.book.cells[2].output.map(line => line.text), ['1']);
        assert.equal(s.book.atPrompt, true);
        assert.ok(s.book.cells.slice(0, -1).every((cell, index) => cell.status === 'ok' && !s.book.isExperimental(index)));
        await s.up();
        assert.equal(s.repl.stepping, false);
        const source = s.book.current.source;
        await s.enter();
        assert.equal(s.book.current.source, source + '\n');
    } finally { s.session.dispose(); }
});

test('Ctrl-R runs only the selected expression and Ctrl-R stops at the following loop header', async () => {
    const s = scenario();
    try {
        await s.type('use sequences');
        await s.enter();
        s.book.active = 0;
        s.book.replace('use sequences\n\n1 + 1');
        s.book.toPrompt();
        s.book.enqueue('for i in 10 to 100\n  (array i)\nend');
        s.book.enqueue('After = 99');
        const source = s.book.fileLines().join('\n');
        s.book.active = 0;
        s.book.cursor = s.book.current.source.length;
        await s.ctrlR();
        assert.deepEqual(s.book.cells[0].output.map(line => line.text), ['2']);
        assert.equal(s.book.active, 1);
        assert.equal(s.book.cursor, 0);
        assert.equal(s.book.cells[1].executed, undefined);
        assert.equal(s.book.cells[2].executed, undefined);
        assert.equal(s.repl.stepping, true);
        await s.ctrlR();
        assert.equal(s.repl.liveIterationFocus.line, 1);
        assert.deepEqual(s.repl.liveOutputs.get(1).map(line => line.text), ['i = 10 · iteration 1']);
        assert.equal(s.repl.liveOutputs.has(2), false);
        await s.enter();
        await s.ctrlR();
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['10']);
        assert.equal(s.book.cells[2].executed, undefined);
        assert.equal(s.book.fileLines().join('\n'), source);
    } finally { s.session.dispose(); }
});

test('returning up from rank> always resumes text editing, not a suspended preview', async () => {
    const s = scenario();
    try {
        s.book.replace('for i in 1 to 3\n  Value = i\nend');
        await s.enter();
        s.book.active = 0;
        s.book.cursor = 0;
        await s.ctrlR();
        assert.equal(s.repl.liveEditing, true);
        s.repl.releaseLiveIteration();
        s.book.toPrompt();
        await s.up();
        assert.equal(s.repl.liveEditing, false);
        assert.equal(s.repl.stepping, false);
        const source = s.book.current.source;
        await s.enter();
        assert.equal(s.book.current.source.split('\n').length, source.split('\n').length + 1);
        assert.equal(s.repl.liveEditing, false);
    } finally { s.session.dispose(); }
});

test('Ctrl-R on a completed loop header reveals its iterator; Esc restores normal text editing', async () => {
    const s = scenario();
    try {
        await s.type('use sequences');
        await s.enter();
        s.book.replace('for i in 10 to 100\n  (array i) len\nend');
        await s.enter();
        assert.equal(s.repl.liveEditing, false);
        s.book.active = 1;
        s.book.cursor = 'for i in 10 to 100'.length;
        await s.ctrlR();
        assert.equal(s.repl.liveIterationFocus.line, 1);
        assert.equal(s.repl.iterationSelecting, true);
        assert.deepEqual(s.repl.liveOutputs.get(1).map(line => line.text), ['i = 10 · iteration 1']);
        await s.right();
        assert.deepEqual(s.repl.liveOutputs.get(1).map(line => line.text), ['i = 11 · iteration 2']);
        await s.esc();
        assert.equal(s.repl.liveEditing, false);
        const source = s.book.current.source;
        await s.enter();
        assert.equal(s.book.current.source.split('\n').length, source.split('\n').length + 1);
        assert.equal(s.repl.liveEditing, false);
    } finally { s.session.dispose(); }
});

test('the next-eval marker stays at the recalculation boundary while selecting a different branch', async () => {
    const s = scenario();
    const frame = () => notebookFrame(s.book, 40, 18, 0, s.repl.suggestion, false, true, '', 'Running…',
        undefined, s.repl.promptLabel, s.repl.liveOutputs, s.repl.exampleFields, s.repl.liveIterationFocus);
    try {
        s.book.replace('for i in 1 to 100\n  (array i)\n  if i less 4\n    (array i i)\n  else\n    (array i i i)\n  end\nend');
        await s.enter();
        s.book.active = 0;
        s.book.cursor = s.book.current.source.indexOf('(array i i i)') + '(array i i i)'.length;
        await s.ctrlR();
        await s.ctrlG();
        for (let index = 0; index < 8; index++) await s.right();
        assert.equal(s.repl.liveIterationFocus.nextLine, 6);
        assert.deepEqual(s.repl.liveOutputs.get(5).map(line => line.text), ['branch runs']);
        assert.equal(s.repl.liveOutputs.has(6), false);
        assert.match(clean(frame().lines.join('\n')), /▶\s+\(array i i i\)/);
        await s.ctrlR();
        assert.match(clean(frame().lines.join('\n')), /▶\s+\(array i i i\)/);
        await s.ctrlR();
        assert.deepEqual(s.repl.liveOutputs.get(6).map(line => line.text), ['9 9 9']);
        assert.match(clean(frame().lines.join('\n')), /▶\s+end/);
        await s.esc();
        assert.doesNotMatch(clean(frame().lines.join('\n')), /▶/);
    } finally { s.session.dispose(); }
});

test('repeated Ctrl-R behaves like Enter throughout evaluation and stops being an alias after Esc', async () => {
    const s = scenario();
    try {
        await s.type('Before = 0');
        await s.enter();
        s.book.replace('for i in 1 to 3\n  Value = i\nend');
        await s.enter();
        await s.type('After = 99');
        await s.enter();
        s.book.active = 1;
        s.book.cursor = 0;
        const source = s.book.current.source;
        await s.ctrlR();
        assert.equal(s.repl.iterationSelecting, true);
        await s.ctrlR();
        assert.equal(s.repl.liveIterationFocused, false);
        assert.equal(s.book.cursor, source.indexOf('\nend'));
        assert.equal(s.repl.liveOutputs.has(2), false);
        await s.ctrlR();
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['1']);
        assert.equal(s.book.cursor, source.length);
        await s.ctrlR();
        assert.equal(s.book.active, 2);
        assert.equal(s.repl.stepping, true);
        await s.ctrlR();
        assert.equal(s.book.atPrompt, true);
        await s.up();
        assert.equal(s.repl.advancing, false);
        s.book.active = 1;
        s.book.cursor = 0;
        await s.ctrlR();
        await s.esc();
        assert.equal(s.repl.advancing, false);
        await s.ctrlR();
        assert.equal(s.repl.iterationSelecting, true, 'Ctrl-R starts selection again after Esc, without inserting text');
        assert.equal(s.book.current.source, source);
    } finally { s.session.dispose(); }
});

test('Ctrl-R on a function loop header directly selects using the existing example', async () => {
    const s = scenario();
    try {
        await s.type('fun visit N');
        await s.enter();
        await s.type('3');
        await s.enter();
        await s.type('for i in 1 to N');
        await s.enter();
        s.book.cursor = s.book.current.source.indexOf('\n  for') + '\n  for i in 1 to N'.length;
        await s.ctrlR();
        assert.equal(s.repl.examplePrompt, undefined);
        assert.equal(s.repl.iterationSelecting, true);
        assert.equal(s.repl.liveIterationFocus.line, 2);
        await s.right();
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['i = 2 · iteration 2']);
        await s.enter();
        assert.equal(s.repl.liveIterationFocused, false);
        assert.equal(s.book.cursor, s.book.current.source.length);
    } finally { s.session.dispose(); }
});

test('Enter after selecting an iteration from the header continues into the body without evaluating it', async () => {
    const s = scenario();
    try {
        await s.type('use sequences');
        await s.enter();
        s.book.replace('for i in 10 to 100\n  (array i) len\nend');
        await s.enter();
        s.book.active = 1;
        s.book.cursor = 'for i in 10 to 100'.length;
        await s.ctrlR();
        await s.right();
        const source = s.book.current.source;
        await s.enter();
        assert.equal(s.repl.liveIterationFocused, false);
        assert.equal(s.book.cursor, source.indexOf('\nend'));
        assert.equal(s.book.current.source, source);
        assert.equal(s.repl.liveOutputs.has(2), false);
        await s.ctrlR();
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['1']);
        assert.equal(s.book.current.source, source);
    } finally { s.session.dispose(); }
});

test('Ctrl-G opens a completed loop directly from its header, body, or end', async () => {
    for (const selected of ['for i', '(array i)', 'end']) {
        const s = scenario();
        try {
            await s.type('use sequences');
            await s.enter();
            s.book.replace('for i in 10 to 100\n  (array i) len\nend');
            await s.enter();
            s.book.active = 1;
            s.book.cursor = s.book.current.source.indexOf(selected) + selected.length;
            const cursor = s.book.cursor;
            await s.ctrlG();
            assert.equal(s.repl.liveIterationFocus.line, 1);
            assert.equal(s.repl.iterationSelecting, true);
            await s.right();
            assert.deepEqual(s.repl.liveOutputs.get(1).map(line => line.text), ['i = 11 · iteration 2']);
            await s.esc();
            assert.equal(s.book.cursor, cursor);
            assert.equal(s.repl.liveEditing, false);
        } finally { s.session.dispose(); }
    }
});

test('Ctrl-G selects the enclosing loop, not an earlier closed inner loop', async () => {
    const s = scenario();
    try {
        await s.type('for I in 1 to 3');
        await s.enter();
        s.book.replace('for I in 1 to 3\n  for J in 1 to 2\n    Value = I + J\n  end\n  Other = I\nend');
        s.book.cursor = s.book.current.source.indexOf('  end');
        await s.ctrlR();
        await s.ctrlG();
        assert.equal(s.repl.liveIterationFocus.line, 2);
        await s.esc();
        s.book.cursor = s.book.current.source.indexOf('  Other') + 5;
        await s.ctrlR();
        const cursor = s.book.cursor;
        await s.ctrlG();
        assert.equal(s.repl.liveIterationFocus.line, 1);
        await s.esc();
        assert.equal(s.book.cursor, cursor);
        assert.equal(s.repl.liveIterationFocused, false);
    } finally { s.session.dispose(); }
});

test('Ctrl-R previews code; Ctrl-G explicitly selects the loop and returns to the same cursor', async () => {
    const s = scenario();
    try {
        await s.type('for I in 1 to 3');
        await s.enter();
        await s.type('Value = I * 2');
        await s.enter();
        await s.type('end');
        await s.enter();
        assert.equal(s.repl.liveEditing, false);

        await s.up();
        await s.ctrlR();
        assert.equal(s.repl.liveIterationFocused, false);
        const cursor = s.book.cursor;
        await s.ctrlG();
        assert.equal(s.repl.liveIterationFocused, true);
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['2']);
        await s.right();
        assert.deepEqual(s.repl.liveOutputs.get(1).map(line => line.text), ['I = 2 · iteration 2']);
        assert.deepEqual(s.repl.liveOutputs.get(2).map(line => line.text), ['4']);
        await s.esc();
        assert.equal(s.repl.liveIterationFocused, false);
        assert.equal(s.book.cursor, cursor);
    } finally { s.session.dispose(); }
});

test('evaluation Enter inserts a disposable line and preserves entered code', async () => {
    const s = scenario();
    try {
        await s.type('fun inc X'); await s.enter();
        await s.type('2'); await s.enter();
        await s.type('Result = X + 1'); await s.enter();
        await s.type('end'); await s.enter();
        s.book.active = 0;
        s.book.cursor = s.book.current.source.indexOf('\nend');
        await s.ctrlR();
        const source = s.book.current.source;
        await s.enter();
        assert.equal(s.book.current.source, source.replace('\nend', '\n  \nend'));
        await s.down();
        assert.equal(s.book.current.source, source);
        await s.up();
        s.book.lineEdge(true);
        await s.enter();
        await s.type('Result *= 2');
        await s.down();
        assert.match(s.book.current.source, /Result \*= 2\nend$/);
        await s.up();
        await s.ctrlR();
        assert.deepEqual(s.repl.liveOutputs.get(3).map(line => line.text), ['6']);
    } finally { s.session.dispose(); }
});
