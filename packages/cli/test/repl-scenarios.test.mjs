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
                undefined, repl.promptLabel, repl.liveOutputs, repl.exampleFields);
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

    return { session, repl, book, trace, type, clear, backspace, enter, ctrlR, up, down };
}

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
