import assert from 'node:assert/strict';
import test from 'node:test';
import { NotebookRepl } from '../out/repl.js';
import { createReplSession } from '../out/repl-session.js';

function scenario() {
    const session = createReplSession();
    const repl = new NotebookRepl(session, () => {}, () => 80, true);
    const line = async text => {
        repl.notebook.insert(text, true);
        await repl.submit();
    };
    const output = number => repl.liveOutputs?.get(number)?.map(item => item.text) ?? [];
    return { session, repl, line, output };
}

test('an open top-level if previews its conditions and only the selected branch', async () => {
    const s = scenario();
    try {
        await s.line('if false');
        assert.deepEqual(s.output(1), ['false · branch skipped']);
        await s.line('X = 1');
        assert.deepEqual(s.output(2), []);
        await s.line('elif true');
        assert.deepEqual(s.output(3), ['true · branch runs']);
        await s.line('X = 2');
        assert.deepEqual(s.output(4), ['2']);
        await s.line('else');
        assert.deepEqual(s.output(5), ['branch skipped']);
        await s.line('X = 3');
        assert.deepEqual(s.output(6), []);
        assert.equal(s.session.names.includes('X'), false, 'preview must not change the global session');

        await s.line('end');
        assert.equal(s.repl.liveEditing, false);
        assert.equal(s.session.names.includes('X'), true);
        assert.deepEqual(s.repl.notebook.cells[0].output.map(item => item.text), ['2']);
    } finally { s.session.dispose(); }
});

test('a function previews if lines with its example and skips inactive nested code', async () => {
    const s = scenario();
    try {
        await s.line('fun choose X');
        s.repl.exampleEditor.insert('2');
        await s.repl.submit();

        await s.line('if X less 0');
        assert.deepEqual(s.output(2), ['false · branch skipped']);
        await s.line('Y = Missing + 1');
        assert.deepEqual(s.output(3), []);
        await s.line('elif X equal 2');
        assert.deepEqual(s.output(4), ['true · branch runs']);
        await s.line('Y = X + 3');
        assert.deepEqual(s.output(5), ['5']);
        await s.line('else');
        assert.equal(s.repl.notebook.current.source.split('\n')[5], '  else');
        assert.deepEqual(s.output(6), ['branch skipped']);
        await s.line('Y = X - 3');
        assert.equal(s.repl.notebook.current.source.split('\n')[6], '    Y = X - 3');
        assert.deepEqual(s.output(7), []);
    } finally { s.session.dispose(); }
});

test('an if nested in an inactive branch is not evaluated', async () => {
    const s = scenario();
    try {
        await s.line('if false');
        await s.line('if 1 / 0 equal 0');
        assert.deepEqual(s.output(2), ['not evaluated · branch skipped']);
        assert.equal(s.repl.liveOutputs?.get(2)?.some(item => item.error), false);
    } finally { s.session.dispose(); }
});

test('else reports when its branch is selected', async () => {
    const s = scenario();
    try {
        await s.line('if false');
        await s.line('else');
        assert.deepEqual(s.output(2), ['branch runs']);
    } finally { s.session.dispose(); }
});

test('a non-boolean if condition reports its error on the condition line', async () => {
    const s = scenario();
    try {
        await s.line('if 1');
        assert.equal(s.repl.liveOutputs?.get(1)?.some(item => item.error), true);
        assert.equal(s.repl.notebook.current.source.slice(0, s.repl.notebook.cursor).split('\n').length, 1);
    } finally { s.session.dispose(); }
});

test('the live status explains what Enter will do on the current line', async () => {
    const s = scenario();
    try {
        await s.line('if true');
        assert.match(s.repl.suggestion, /Enter keep blank line/);
        s.repl.notebook.insert('X = 1');
        assert.match(s.repl.suggestion, /Enter evaluate line/);
        await s.repl.submit();
        s.repl.notebook.insert('else');
        assert.match(s.repl.suggestion, /Enter enter branch/);
        await s.repl.submit();
        s.repl.notebook.insert('end');
        assert.match(s.repl.suggestion, /Enter apply end/);
    } finally { s.session.dispose(); }
});

test('live if lines format and dedent as soon as Enter is pressed', async () => {
    const s = scenario();
    try {
        await s.line('if 1+1 equal 2');
        assert.equal(s.repl.notebook.current.source, 'if 1 + 1 equal 2\n  ');
        await s.line('X=1');
        assert.match(s.repl.notebook.current.source, /\n  X = 1\n  $/);
        await s.line('else');
        assert.match(s.repl.notebook.current.source, /\nelse\n  $/);
        await s.line('X=2');
        await s.line('end');
        assert.deepEqual(s.repl.notebook.cells[0].source.split('\n'), [
            'if 1 + 1 equal 2',
            '  X = 1',
            'else',
            '  X = 2',
            'end',
        ]);
    } finally { s.session.dispose(); }
});

test('Ctrl-R reopens an existing if and stops before the selected line', async () => {
    const s = scenario();
    try {
        await s.line('if true');
        await s.line('X = 4');
        await s.line('end');
        s.repl.notebook.active = 0;
        s.repl.notebook.cursor = s.repl.notebook.current.source.indexOf('X = 4') + 'X = 4'.length;

        await s.repl.rerun();
        assert.equal(s.repl.liveEditing, true);
        assert.deepEqual(s.output(1), ['true · branch runs']);
        assert.deepEqual(s.output(2), []);
        await s.repl.submit();
        assert.deepEqual(s.output(2), ['4']);
        assert.equal(s.repl.notebook.current.source.slice(0, s.repl.notebook.cursor).split('\n').length, 3);
    } finally { s.session.dispose(); }
});

test('cancelling a reopened if restores its cell and returns to the prompt', async () => {
    const s = scenario();
    try {
        await s.line('if true');
        await s.line('X = 4');
        await s.line('end');
        const original = s.repl.notebook.cells[0].source;
        s.repl.notebook.active = 0;
        s.repl.notebook.cursor = original.indexOf('X = 4') + 'X = 4'.length;
        await s.repl.rerun();

        s.repl.cancelLiveFunction();
        assert.equal(s.repl.liveEditing, false);
        assert.equal(s.repl.notebook.cells[0].source, original);
        assert.equal(s.repl.notebook.atPrompt, true);
        assert.equal(s.repl.notebook.current.source, '');
    } finally { s.session.dispose(); }
});

test('a collection loop previews one selected iteration and waits for explicit recalculation', async () => {
    const s = scenario();
    try {
        await s.line('for I in 1 to 3');
        assert.deepEqual(s.output(1), ['I = 1 · iteration 1']);
        assert.equal(s.repl.releaseLiveIteration(), true);
        await s.line('Value = I * 2');
        assert.deepEqual(s.output(2), ['2']);

        const source = s.repl.notebook.current.source;
        s.repl.notebook.cursor = source.indexOf('Value = I * 2') + 'Value = I * 2'.length;
        assert.equal(s.repl.focusLiveIterationFromBody(), true);
        assert.equal(await s.repl.moveLiveIteration(1), true);
        assert.equal(s.repl.notebook.current.source, source);
        assert.deepEqual(s.output(1), ['I = 2 · iteration 2']);
        assert.equal(s.repl.liveOutputs.has(2), false, 'selecting must clear stale body previews');
        assert.match(s.repl.suggestion, /iteration 2 · ←\/→ select · Enter body/);

        assert.equal(s.repl.releaseLiveIteration(), true);
        await s.repl.submit();
        assert.deepEqual(s.output(1), ['I = 2 · iteration 2']);
        assert.deepEqual(s.output(2), ['4']);
        assert.equal(s.repl.notebook.current.source, source, 'recalculation must not add a blank line');

        await s.repl.submit();
        assert.notEqual(s.repl.notebook.current.source, source, 'the next Enter keeps a blank line');

        s.repl.notebook.cursor = s.repl.notebook.current.source.indexOf('Value = I * 2') + 'Value = I * 2'.length;
        assert.equal(s.repl.focusLiveIterationFromBody(), true);
        assert.equal(await s.repl.moveLiveIteration(1), true);
        assert.equal(await s.repl.moveLiveIteration(1), true);
        assert.equal(s.repl.releaseLiveIteration(), true);
        await s.repl.submit();
        assert.deepEqual(s.output(1), ['iteration 4 · loop skipped']);
        assert.deepEqual(s.output(2), []);
    } finally { s.session.dispose(); }
});

test('a condition-controlled loop previews at most one iteration', async () => {
    for (const [condition, expected, body] of [
        ['false', 'false · loop skipped', []],
        ['true', 'true · loop runs', ['2']],
    ]) {
        const s = scenario();
        try {
            await s.line(`for ${condition}`);
            assert.deepEqual(s.output(1), [expected]);
            await s.line('Value = 2');
            assert.deepEqual(s.output(2), body);
        } finally { s.session.dispose(); }
    }
});

test('a nested if follows the selected function-loop iteration', async () => {
    const s = scenario();
    try {
        await s.line('fun inspect N');
        s.repl.exampleEditor.insert('3');
        await s.repl.submit();
        await s.line('for I in 1 to N');
        assert.equal(s.repl.releaseLiveIteration(), true);
        await s.line('if I equal 2');
        await s.line('Seen = I');
        assert.deepEqual(s.output(3), ['false · branch skipped']);
        assert.deepEqual(s.output(4), []);

        const source = s.repl.notebook.current.source;
        s.repl.notebook.cursor = source.indexOf('if I equal 2') + 'if I equal 2'.length;
        assert.equal(s.repl.focusLiveIterationFromBody(), true);
        assert.equal(await s.repl.moveLiveIteration(1), true);
        assert.deepEqual(s.output(2), ['I = 2 · iteration 2']);
        assert.equal(s.repl.liveOutputs.has(3), false);
        assert.equal(s.repl.liveOutputs.has(4), false);
        assert.equal(s.repl.releaseLiveIteration(), true);
        s.repl.notebook.cursor = source.indexOf('Seen = I') + 'Seen = I'.length;
        await s.repl.submit();
        assert.deepEqual(s.output(2), ['I = 2 · iteration 2']);
        assert.deepEqual(s.output(3), ['true · branch runs']);
        assert.deepEqual(s.output(4), ['2']);
    } finally { s.session.dispose(); }
});

test('a nested loop keeps its own selected iteration for each outer value', async () => {
    const s = scenario();
    try {
        await s.line('for I in 1 to 2');
        assert.equal(s.repl.releaseLiveIteration(), true);
        await s.line('for J in 3 to 4');
        assert.equal(s.repl.releaseLiveIteration(), true);
        await s.line('Value = I * 10 + J');
        let source = s.repl.notebook.current.source;
        s.repl.notebook.cursor = source.indexOf('Value = I * 10 + J') + 'Value = I * 10 + J'.length;
        assert.equal(s.repl.focusLiveIterationFromBody(), true);
        assert.equal(await s.repl.moveLiveIteration(1), true);
        assert.equal(s.repl.releaseLiveIteration(), true);
        s.repl.notebook.cursor = source.indexOf('Value = I * 10 + J') + 'Value = I * 10 + J'.length;
        await s.repl.submit();
        assert.deepEqual(s.output(2), ['J = 4 · iteration 2']);
        assert.deepEqual(s.output(3), ['14']);
        await s.line('end');

        source = s.repl.notebook.current.source;
        s.repl.notebook.cursor = source.indexOf('for J in 3 to 4') + 'for J in 3 to 4'.length;
        assert.equal(s.repl.focusLiveIterationFromBody(), true);
        assert.equal(await s.repl.moveLiveIteration(1), true);
        assert.equal(s.repl.releaseLiveIteration(), true);
        s.repl.notebook.cursor = source.indexOf('Value = I * 10 + J') + 'Value = I * 10 + J'.length;
        await s.repl.submit();
        assert.deepEqual(s.output(1), ['I = 2 · iteration 2']);
        assert.deepEqual(s.output(2), ['J = 4 · iteration 2']);
        assert.deepEqual(s.output(3), ['24']);
    } finally { s.session.dispose(); }
});
