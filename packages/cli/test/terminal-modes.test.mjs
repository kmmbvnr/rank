import assert from 'node:assert/strict';
import test from 'node:test';
import { Notebook } from '../out/notebook.js';
import { TerminalModeRouter } from '../out/terminal-modes.js';

test('help navigation is contained in the terminal mode router', async () => {
    const repl = { running: false, help: { text: 'help', top: 2 } };
    const router = new TerminalModeRouter(repl, () => 10);
    assert.equal(router.active, true);
    await router.press('', { name: 'down' });
    assert.equal(repl.help.top, 3);
    await router.press('', { name: 'pageup' });
    assert.equal(repl.help.top, -6);
    await router.press('', { name: 'end' });
    assert.equal(repl.help.top, Number.MAX_SAFE_INTEGER);
    await router.press('', { name: 'escape' });
    assert.equal(repl.help, undefined);
    assert.equal(router.active, false);
});

test('save filename editing and discard stay inside the save mode', async () => {
    const filename = new Notebook();
    const repl = {
        running: false,
        savePrompt: { choosing: false, exitAfterSave: false, filename, error: '' },
        session: {},
        async savePromptFile() { return false; },
        discardChanges() { this.savePrompt = undefined; return true; },
    };
    const router = new TerminalModeRouter(repl);
    await router.press('/tmp/test.ra', {});
    assert.equal(filename.current.source, '/tmp/test.ra');
    await router.press('', { name: 'backspace' });
    assert.equal(filename.current.source, '/tmp/test.r');
    repl.savePrompt.choosing = true;
    const result = await router.press('d', {});
    assert.equal(result.exit, true);
    assert.equal(repl.savePrompt, undefined);
});

test('debugger keys update pause navigation and expose the advancing state', async () => {
    let stepped = 0;
    const session = {
        pauseState: {},
        step(iteration) { stepped += iteration ? 10 : 1; this.pauseState = undefined; },
    };
    const repl = {
        running: true, pauseTop: 5, session,
        interrupt() {}, togglePause() {},
    };
    const router = new TerminalModeRouter(repl, () => 12);
    await router.press('', { name: 'pageup' });
    assert.equal(repl.pauseTop, -5);
    await router.press('n', { name: 'n' });
    assert.equal(stepped, 10);
    assert.equal(repl.pauseTop, 0);
    assert.equal(router.waitingForPause, true);
    assert.equal(router.allowRender(), true);
    repl.running = false;
    assert.equal(router.allowRender(), true);
    assert.equal(router.waitingForPause, false);
});

test('debugger reports an unknown key until the next known key', async () => {
    const repl = {
        running: true, pauseTop: 0, session: { pauseState: {} },
        interrupt() {}, togglePause() {},
    };
    const router = new TerminalModeRouter(repl);
    await router.press('x', { name: 'x' });
    assert.equal(router.pauseStatus, 'Unknown key: x');
    await router.press('', { name: 'down' });
    assert.equal(router.pauseStatus, '');
});

test('bracketed paste is accepted only by the active modal surface', () => {
    const filename = new Notebook();
    const repl = {
        running: false,
        savePrompt: { choosing: false, exitAfterSave: false, filename, error: '' },
    };
    const router = new TerminalModeRouter(repl);
    assert.equal(router.paste('a\nb.ra'), true);
    assert.equal(filename.current.source, 'ab.ra');
    repl.savePrompt = undefined;
    assert.equal(router.paste('body'), false);
});
