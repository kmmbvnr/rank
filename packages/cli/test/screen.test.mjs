import assert from 'node:assert/strict';
import test from 'node:test';
import xterm from '@xterm/headless';
import stringWidth from 'string-width';
import { Notebook } from '../out/notebook.js';
import { NotebookRepl } from '../out/repl.js';
import { createReplSession } from '../out/repl-session.js';
import { editableRows, notebookFrame, drawFrame, saveFrame, pauseFrame } from '../out/screen.js';

const { Terminal } = xterm;
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
const text = terminal => Array.from({ length: terminal.rows }, (_, i) =>
    terminal.buffer.active.getLine(i).translateToString(true)).join('\n');

test('pause context marks the current line in color and fits narrow terminals', async t => {
    const source = 'fun count N\n  Total = 0\n  for I in 1 to N\n    Total += I\n  end\n  return Total\nend';
    for (const columns of [24, 80]) {
        const terminal = new Terminal({ cols: columns, rows: 24, allowProposedApi: true });
        t.after(() => terminal.dispose());
        const frame = pauseFrame({ source, line: 4, activity: 'before line 4' }, columns, 24);
        await write(terminal, drawFrame(frame));
        const output = text(terminal);
        assert.match(output, /● 4 │     Total \+= I/);
        assert.match(output, /2 │   Total = 0/);
        assert.match(output, /5 │   end/);
        assert.doesNotMatch(output, /fun count|6 │|7 │/);
        const row = output.split('\n').findIndex(line => line.startsWith('● 4'));
        const marker = terminal.buffer.active.getLine(row).getCell(0);
        assert.ok(marker.isBold());
        assert.equal(marker.getFgColor(), 3);
        for (const line of frame.lines) assert.ok(stringWidth(line) < columns);
        assert.equal(terminal.buffer.active.baseY, 0);
    }
});

test('pause context keeps four source lines and stable state position near the start', () => {
    const source = 'for\n  Lower = Power\n  Upper = (10 * Power - 1)\nend';
    const state = 'Call stack (outermost first):\n<cell>\n\nVariables (current scope):\n  Power = 1';
    const frames = [1, 2].map(line => pauseFrame({ source, line, activity: `before line ${line}`, state }, 80, 20));
    for (const frame of frames) assert.equal(frame.lines.filter(row => row.includes('│')).length, 4);
    assert.equal(
        frames[0].lines.findIndex(row => row.includes('Variables (current scope):')),
        frames[1].lines.findIndex(row => row.includes('Variables (current scope):')),
    );
});

test('pause footer shows an unknown-key status', () => {
    const frame = pauseFrame({ activity: 'evaluating' }, 80, 8, 0, 'Unknown key: x');
    assert.equal(frame.lines.at(-1), 'Unknown key: x');
});

test('live replay marks evaluated lines orange and remaining lines gray', () => {
    const book = new Notebook();
    book.replace('fun inspect N\n  A = N + 1\n  B = A * 2\nend');
    book.cursor = book.current.source.indexOf('B =') + 'B = A * 2'.length;
    const outputs = new Map([[1, []], [2, [{ text: '3', error: false }]]]);
    const frame = notebookFrame(book, 60, 10, 0, '', false, true, '', 'Running…',
        undefined, 'rank> ', outputs);
    const sourceLine = value => frame.lines.find(line => line.includes(value));
    assert.match(sourceLine('fun inspect'), /\x1b\[38;5;208m/);
    assert.match(sourceLine('A = N'), /\x1b\[38;5;208m/);
    assert.match(sourceLine('B = A'), /\x1b\[90m/);
    assert.match(sourceLine('end'), /\x1b\[90m/);
});

test('inline preview errors retain parentheses without generated source locations', async t => {
    const session = createReplSession();
    t.after(() => session.dispose());
    await session.execute('use sequences', 0, []);
    const result = session.preview('RankReplPreviewValue = ((array 1) count)');
    assert.equal(result.ok, false);
    assert.match(result.output[0].text, /<repl>/, 'full diagnostics remain available');
    const book = new Notebook();
    book.replace('(array 1) count');
    const frame = notebookFrame(book, 100, 12, 0, '', false, true, '', 'Running…',
        undefined, 'rank> ', new Map([[1, result.output]]));
    const rendered = frame.lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    const errorLines = rendered.split('\n').filter(line => line.includes('! '));
    assert.ok(errorLines.every(line => stringWidth(line) <= 40));
    const message = errorLines.map(line => line.slice(line.indexOf('! ') + 2)).join(' ');
    assert.match(message, /TypeError: count expects boolean values/);
    assert.doesNotMatch(message, /error:|RankError/);
    assert.match(rendered, /! \(array 1\) count/);
    assert.doesNotMatch(rendered, /RankReplPreviewValue|<repl>|\^/);
});

test('error wrapping keeps words intact in both live and completed instructions', () => {
    const message = 'Runtime: unknown name: count; did you forget `use sequences`?';
    for (const live of [false, true]) {
        for (const columns of [32, 80]) {
            const book = new Notebook();
            const output = [{ text: message, error: true }];
            if (live) book.replace('(array i) count');
            else {
                book.enqueue('(array i) count');
                book.finish(0, { source: '(array i) count', output, ok: false, command: false });
            }
            const frame = notebookFrame(book, columns, 20, 0, '', false, true, '', 'Running…',
                undefined, 'rank> ', live ? new Map([[1, output]]) : undefined);
            const lines = frame.lines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))
                .filter(line => line.startsWith('    ! '));
            assert.ok(lines.every(line => stringWidth(line) <= Math.min(40, columns - 1)));
            assert.equal(lines.map(line => line.slice(6)).join(' '), message);
            assert.ok(lines.some(line => /\bdid\b/.test(line)));
        }
    }
});

test('moving through executed source does not create a live marker', () => {
    const book = new Notebook();
    book.enqueue('A = 1\nB = A + 1');
    book.cells[0].executed = book.cells[0].source;
    book.cells[0].status = 'ok';
    book.active = 0;
    book.cursor = book.cells[0].source.indexOf('B =');
    const frame = notebookFrame(book, 60, 10);
    assert.doesNotMatch(frame.lines.join('\n'), /\x1b\[(?:33|90)m\s+●/);
});

test('iteration-field focus keeps the pending body gray until Enter', () => {
    const book = new Notebook();
    book.replace('for i in 1 to 10\n  A = i\nend');
    book.cursor = book.current.source.indexOf('A = i') + 'A = i'.length;
    const outputs = new Map([[1, [{ text: 'i = 5 · iteration 5', error: false }]]]);
    const frame = notebookFrame(book, 60, 10, 0, '', false, true, '', 'Running…',
        undefined, 'rank> ', outputs, undefined, { line: 1, offset: 5 });
    const body = frame.lines.find(line => line.includes('A = i'));
    assert.match(body, /\x1b\[90m/);
    assert.doesNotMatch(body, /\x1b\[33m/);
});

async function draw(terminal, book, top = 0, hint = '', running = false) {
    if (terminal.buffer.active.type !== 'alternate') await write(terminal, '\x1b[?1049h');
    const frame = notebookFrame(book, terminal.cols, terminal.rows, top, hint, running);
    await write(terminal, drawFrame(frame));
    assert.equal(terminal.buffer.active.cursorX, frame.cursor.column);
    assert.equal(terminal.buffer.active.cursorY, frame.cursor.row);
    assert.equal(terminal.buffer.active.baseY, 0, 'rendering scrolled the terminal');
    return frame;
}

test('wraps by display width and maps Unicode cursor offsets without changing source', () => {
    const source = 'аб界e\u0301Z';
    const rows = editableRows(source, 4);
    assert.deepEqual(rows.map(row => row.text), ['аб界', 'e\u0301Z']);
    assert.deepEqual(rows[1].points, [
        { offset: 3, column: 0 }, { offset: 5, column: 1 }, { offset: 6, column: 2 },
    ]);
    assert.deepEqual(editableRows('abcd', 4).map(row => row.text), ['abcd', '']);
});

test('a shortened wrapped line erases old rows and places the cursor at its real position', async t => {
    const terminal = new Terminal({ cols: 20, rows: 8, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    book.replace('1234567890123456789012345678901234567890');
    await draw(terminal, book);
    book.cursor = 0;
    await draw(terminal, book);
    assert.equal(terminal.buffer.active.cursorY, 0);
    assert.equal(terminal.buffer.active.cursorX, 6);
    book.replace('A = 1');
    await draw(terminal, book);
    assert.equal(text(terminal).split('\n')[0], 'rank> A = 1');
    assert.doesNotMatch(text(terminal), /23456789/);
});

test('resize recomputes all rows and cursor mappings in both directions', async t => {
    const terminal = new Terminal({ cols: 80, rows: 12, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    book.replace('S = "' + '界'.repeat(30) + '"');
    for (const [columns, rows] of [[80, 12], [20, 8], [40, 10], [12, 4], [80, 12]]) {
        terminal.resize(columns, rows);
        const frame = await draw(terminal, book);
        for (const line of frame.lines) assert.ok(stringWidth(line) < columns);
        assert.ok(frame.cursor.column < columns);
        assert.ok(frame.cursor.row < rows);
    }
    assert.equal(book.current.source, 'S = "' + '界'.repeat(30) + '"');
});

test('scrolling to old source and back redraws from the document with no duplicate text', async t => {
    const terminal = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    for (let i = 0; i < 30; i++) {
        book.enqueue(`A = ${i}`);
        const cell = book.cells[i];
        cell.executed = cell.source;
        cell.status = 'ok';
        cell.output = [{ text: String(i), error: false }];
    }
    let frame = await draw(terminal, book);
    assert.match(text(terminal), /A = 29/);
    book.active = 0; book.cursor = 0;
    frame = await draw(terminal, book, frame.top);
    assert.match(text(terminal), /A = 0\n/);
    assert.doesNotMatch(text(terminal), /A = 29/);
    book.toPrompt();
    await draw(terminal, book, frame.top);
    assert.match(text(terminal), /A = 29/);
});

test('only the current completion is visible and dismissing it clears its row', async t => {
    const terminal = new Terminal({ cols: 70, rows: 8, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    await draw(terminal, book, 0, 'Tab: numbers (1/2)');
    await draw(terminal, book, 0, 'Tab: sequences (2/2)');
    assert.match(text(terminal), /Tab: sequences/);
    assert.doesNotMatch(text(terminal), /Tab: numbers/);
    await draw(terminal, book);
    assert.doesNotMatch(text(terminal), /Tab:/);
});

test('execution indicators turn gray after an edit and old errors vanish after successful replay', async t => {
    const terminal = new Terminal({ cols: 60, rows: 14, allowProposedApi: true });
    const session = createReplSession();
    t.after(() => { terminal.dispose(); session.dispose(); });
    const repl = new NotebookRepl(session);
    const book = repl.notebook;
    book.replace('A = 1'); await repl.submit();
    book.replace('B = A + 1'); await repl.submit();
    await draw(terminal, book);
    const firstColor = terminal.buffer.active.getLine(0).getCell(0).getFgColor();
    assert.equal(firstColor, 2, 'executed circle should be green');
    book.active = 0; book.replace('A = Missing');
    await draw(terminal, book);
    assert.equal(terminal.buffer.active.getLine(0).getCell(0).getFgColor(), 8);
    assert.equal(terminal.buffer.active.getLine(2).getCell(0).getFgColor(), 8);
    book.toPrompt(); await repl.submit();
    await draw(terminal, book);
    assert.match(text(terminal), /unknown name/);
    assert.equal(book.active, 0);
    assert.equal(terminal.buffer.active.getLine(0).getCell(0).getFgColor(), 1);
    book.replace('A = 5'); book.toPrompt(); await repl.submit();
    await draw(terminal, book);
    assert.doesNotMatch(text(terminal), /unknown name/);
    assert.match(text(terminal), /\n      6\n/);
    assert.equal(terminal.buffer.active.getLine(0).getCell(0).getFgColor(), 208);
});

test('source and output control characters cannot move the renderer cursor', async t => {
    const terminal = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    book.enqueue('S = "\x1b[2J"');
    book.cells[0].output = [{ text: '\x1b[2Jresult\x1b[10;10H', error: false }];
    await draw(terminal, book);
    assert.match(text(terminal), /S = "\?\[2J"/);
    assert.match(text(terminal), /result/);
});

test('Page Up can inspect output taller than the screen without moving the source cursor', async t => {
    const terminal = new Terminal({ cols: 50, rows: 8, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    book.enqueue('help');
    book.cells[0].command = true;
    book.cells[0].output = Array.from({ length: 30 }, (_, i) => ({ text: `help line ${i}`, error: false }));
    await draw(terminal, book);
    const cursor = book.cursor;
    const frame = notebookFrame(book, 50, 8, 0, '', false, false);
    await write(terminal, drawFrame(frame));
    assert.match(text(terminal), /help line 0/);
    assert.equal(frame.cursorVisible, false);
    assert.equal(book.cursor, cursor);
    assert.equal(book.atPrompt, true);
});

test('an error near the bottom reveals its wrapped diagnostic and the prompt while keeping the edit cursor', async t => {
    const terminal = new Terminal({ cols: 70, rows: 12, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    for (let i = 0; i < 20; i++) {
        book.enqueue(`A = ${i}`);
        book.cells[i].executed = book.cells[i].source;
        book.cells[i].status = 'ok';
    }
    let frame = await draw(terminal, book);
    book.enqueue('G sum');
    const index = book.cells.length - 2;
    book.finish(index, {
        source: 'G sum', command: false, ok: false,
        output: [{ error: true, text: [
            'error: RankError [ConsumedSequence]: sequence tst has already been consumed; return to its consuming line to replay it',
            '  at <repl>:1:1', '1 | G sum', '    ^',
        ].join('\n') }],
    });
    book.replayFrom = index;
    book.focusError(index);
    frame = await draw(terminal, book, frame.top);
    assert.match(text(terminal), /error: RankError/);
    const diagnostic = text(terminal).split('\n').filter(line => line.startsWith('    ! '));
    assert.ok(diagnostic.every(line => stringWidth(line) <= 40));
    assert.match(diagnostic.map(line => line.slice(6)).join(' '), /consuming line to replay it/);
    assert.match(text(terminal), /\^\nrank> /);
    assert.equal(frame.cursorVisible, true);
    assert.match(text(terminal).split('\n')[frame.cursor.row], /› G sum$/);
    assert.equal(frame.cursor.column, 11);
    assert.equal(book.active, index);
});

test('an error taller than the viewport keeps its beginning editable and allows scrolling to the end', async t => {
    const terminal = new Terminal({ cols: 60, rows: 8, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    for (let i = 0; i < 20; i++) {
        book.enqueue(`A = ${i}`);
        book.cells[i].executed = book.cells[i].source;
        book.cells[i].status = 'ok';
    }
    const previous = await draw(terminal, book);
    book.enqueue('Missing');
    const index = book.cells.length - 2;
    book.finish(index, {
        source: 'Missing', command: false, ok: false,
        output: Array.from({ length: 20 }, (_, i) => ({ text: `diagnostic ${i}`, error: true })),
    });
    book.replayFrom = index;
    book.focusError(index);
    const frame = await draw(terminal, book, previous.top);
    assert.equal(frame.cursor.row, 0);
    assert.equal(frame.cursorVisible, true);
    assert.match(text(terminal), /diagnostic 0/);
    const scrolled = notebookFrame(book, 60, 8, Number.MAX_SAFE_INTEGER, '', false, false);
    await write(terminal, drawFrame(scrolled));
    assert.match(text(terminal), /diagnostic 19\nrank> /);
    assert.equal(scrolled.cursorVisible, false);
    assert.equal(book.active, index);
    assert.equal(book.cursor, 'Missing'.length);
});

test('output is gray and begins in the same column as source, including wrapped rows', async t => {
    const terminal = new Terminal({ cols: 30, rows: 10, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const book = new Notebook();
    book.enqueue('A = 1');
    book.cells[0].output = [{ text: '12345678901234567890123456789', error: false }];
    await draw(terminal, book);
    for (const row of [1, 2]) {
        const line = terminal.buffer.active.getLine(row);
        assert.match(line.translateToString(true), /^ {6}\d/);
        assert.equal(line.getCell(6).getFgColor(), 8);
    }
});

test('save dialog wraps a long filename and keeps its cursor visible after resize', async t => {
    const terminal = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const filename = new Notebook();
    filename.replace('/tmp/папка/very-long-program-name.ra');
    for (const [columns, height] of [[40, 10], [16, 5], [4, 2], [80, 12]]) {
        terminal.resize(columns, height);
        const frame = saveFrame(filename, 'Cannot save here', columns, height);
        await write(terminal, drawFrame(frame));
        assert.ok(frame.cursor.row >= 0 && frame.cursor.row < height);
        assert.ok(frame.cursor.column >= 0 && frame.cursor.column < columns);
        assert.equal(terminal.buffer.active.cursorY, frame.cursor.row);
        assert.equal(terminal.buffer.active.cursorX, frame.cursor.column);
        for (const line of frame.lines) assert.ok(stringWidth(line) < columns);
    }
});
