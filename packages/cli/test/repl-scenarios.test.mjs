import assert from 'node:assert/strict';
import test from 'node:test';
import { NotebookRepl } from '../out/repl.js';
import { createReplSession } from '../out/repl-session.js';
import { notebookFrame } from '../out/screen.js';

const clean = text => text.replace(/\x1b\[[0-9;]*m/g, '');

/** A fast keyboard-level driver for state transitions; representative paths also run through the real PTY tests. */
function scenario() {
    const session = createReplSession();
    const repl = new NotebookRepl(session, undefined, undefined, true);
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
    const target = () => repl.examplePrompt ? repl.exampleEditor : book;
    const type = text => { target().insert(text, true); check(`type ${JSON.stringify(text)}`); };
    const clear = () => { target().replace(''); check('Ctrl-U'); };
    const backspace = () => { target().erase(true); check('Backspace'); };
    const enter = async () => { await repl.submit(); check('Enter'); };
    const ctrlR = async () => { await repl.rerun(); check('Ctrl-R'); };
    const up = () => { book.vertical(-1, 74); check('Up'); };

    return { session, repl, book, trace, type, clear, backspace, enter, ctrlR, up };
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
                            s.type(headerTypo ? 'func inc X' : 'fun inc X');
                            await s.enter();
                            if (headerTypo) {
                                assert.match(s.book.current.output.map(line => line.text).join('\n'), /unknown name: func/);
                                s.clear();
                                s.type('fun inc X');
                                await s.enter();
                            }

                            if (argumentTypo) {
                                s.type('A = 1');
                                await s.enter();
                                assert.ok(s.repl.examplePrompt, s.trace.join(' -> '));
                                assert.match(s.repl.exampleFields[0].error, /Syntax/);
                                s.clear();
                            }
                            s.type('1');
                            await s.enter();

                            s.type(bodyTypo ? 'Result = X + )' : 'Result = X + 1');
                            await s.enter();
                            if (bodyTypo) {
                                assert.ok(s.repl.liveOutputs.get(2).some(line => line.error), s.trace.join(' -> '));
                                s.backspace();
                                s.type('1');
                                await s.enter();
                            }
                            s.type('Result *= 2');
                            await s.enter();
                            s.type('end');
                            await s.enter();
                            assert.equal(s.repl.liveEditing, false, s.trace.join(' -> '));

                            s.up(); // prompt -> outer end
                            const extraUps = selected === 'header' ? 3 : selected === 'first body line' ? 2 : 1;
                            for (let index = 0; index < extraUps; index++) s.up();
                            await s.ctrlR();
                            assert.ok(s.repl.examplePrompt, s.trace.join(' -> '));
                            s.clear();
                            s.type(replacement);
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
