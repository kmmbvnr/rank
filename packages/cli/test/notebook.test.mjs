import assert from 'node:assert/strict';
import test from 'node:test';
import { Notebook } from '../out/notebook.js';
import { NotebookRepl } from '../out/repl.js';
import { createReplSession } from '../out/repl-session.js';
import { notebookFrame } from '../out/screen.js';
import { formatSource } from '../out/source-format.js';

function setup(t) {
    const session = createReplSession();
    t.after(() => session.dispose());
    const repl = new NotebookRepl(session);
    const book = repl.notebook;
    const enter = async source => { book.toPrompt(); book.replace(source); return repl.submit(); };
    const edit = (index, source) => { book.active = index; book.replace(source); };
    return { repl, book, enter, edit };
}

const output = cell => cell.output.map(line => line.text).join('\n');

test('Enter commits new input before replay, executes only the changed suffix and replaces results', async t => {
    const { book, enter, edit } = setup(t);
    await enter('Count = 1');
    await enter('Count += 1');
    await enter('B = Count * 2');
    assert.equal(output(book.cells[2]), '4');
    edit(1, 'Count += 3');
    assert.equal(book.dirtyFrom, 1);
    // The prefix is not replayed: Count was 2, so the correction makes it 5.
    await enter('B + 1');
    assert.equal(output(book.cells[1]), '5');
    assert.equal(output(book.cells[2]), '10');
    assert.equal(output(book.cells[3]), '11');
    assert.equal(book.dirtyFrom, -1);
    assert.equal(book.current.source, '');
    assert.equal(book.cells.length, 5);
});

test('first replay error stops execution, focuses that cell and retains the newly submitted instruction', async t => {
    const { book, enter, edit } = setup(t);
    await enter('A = 1');
    await enter('B = A + 2');
    await enter('C = B + 3');
    edit(0, 'A = 0');
    edit(1, 'B = 1 // A');
    await enter('D = 99');
    assert.equal(book.active, 1);
    assert.equal(book.cells[1].status, 'error');
    assert.match(output(book.cells[1]), /division by zero/);
    assert.equal(output(book.cells[2]), '6');
    assert.equal(book.cells[3].source, 'D = 99');
    assert.equal(book.cells[3].executed, undefined);
    assert.equal(book.dirtyFrom, 1);
    edit(1, 'B = 8');
    const length = book.cells.length;
    await enter('');
    assert.equal(book.cells.length, length, 'empty Enter resumes pending code without inserting spacing');
    assert.equal(output(book.cells[1]), '8');
    assert.equal(output(book.cells[2]), '11');
    assert.equal(output(book.cells[3]), '99');
    assert.doesNotMatch(notebookFrame(book, 80, 24).lines.join('\n'), /division by zero/);
    assert.equal(book.dirtyFrom, -1);
});

test('a new failing instruction is in the document and focused for correction', async t => {
    const { book, enter, edit } = setup(t);
    await enter('Missing + 1');
    assert.equal(book.active, 0);
    assert.equal(book.cells.length, 2);
    assert.match(output(book.current), /unknown name/);
    edit(0, '1 + 2');
    await enter('');
    assert.equal(output(book.cells[0]), '3');
    assert.equal(book.atPrompt, true);
});

test('empty Enter runs pending instructions; only a clean document gets a blank line', async t => {
    const { book, enter, edit } = setup(t);
    await enter('A = 1');
    await enter('B = A + 1');
    edit(0, 'A = 5');
    await enter('');
    assert.deepEqual(book.fileLines(), ['A = 5', 'B = A + 1']);
    assert.equal(output(book.cells[1]), '6');
    assert.equal(book.atPrompt, true);
    await enter('');
    assert.deepEqual(book.fileLines(), ['A = 5', 'B = A + 1', '']);
    assert.equal(book.dirtyFrom, -1);
});

test('navigation does not execute, preserves both edits and the draft, and Enter inside old code inserts a line', async t => {
    const { book, repl, enter } = setup(t);
    await enter('A = 1');
    book.replace('Draft');
    book.vertical(-1, 20);
    book.replace('A = 2');
    await repl.submit();
    assert.equal(book.current.source, 'A = 2\n');
    assert.equal(output(book.cells[0]), '1');
    book.toPrompt();
    assert.equal(book.current.source, 'Draft');
    assert.equal(book.dirtyFrom, 0);
});

test('blocks and folded expressions accumulate at the bottom, with a blank line closing a block', async t => {
    const { book, repl, enter } = setup(t);
    await enter('fun twice X');
    assert.equal(book.cells.length, 1);
    assert.equal(book.current.source, 'fun twice X\n  ');
    book.insert('return X * 2');
    await repl.submit();
    assert.equal(book.current.source, 'fun twice X\n  return X * 2\n  ');
    await repl.submit();
    assert.equal(book.cells[0].status, 'ok');
    await enter('4 twice');
    assert.equal(output(book.cells[1]), '8');
    await enter('A = 1 +');
    book.insert('2');
    await repl.submit();
    assert.equal(output(book.cells[2]), '3');
});

test('long source never acquires new lines or parentheses from terminal width', async t => {
    const { book, enter } = setup(t);
    const source = 'Wide = 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12';
    await enter(source);
    const formatted = formatSource(source);
    for (const width of [12, 20, 40, 80, 120]) notebookFrame(book, width, 10);
    assert.equal(book.cells[0].source, formatted);
    assert.equal(book.fileLines().join('\n'), formatted);
});

test('up/down moves by visual rows, including the exact wrap boundary', () => {
    const book = new Notebook();
    book.replace('abcdefghij');
    book.vertical(-1, 5);
    assert.equal(book.cursor, 5);
    book.vertical(-1, 5);
    assert.equal(book.cursor, 0);
    book.vertical(1, 5);
    assert.equal(book.cursor, 5);
    book.horizontal(1);
    book.insert('X');
    assert.equal(book.current.source, 'abcdefXghij');
});

test('Unicode graphemes survive cursor movement, deletion, undo and redo', () => {
    const book = new Notebook();
    book.replace('A界e\u0301👩‍💻Z');
    book.horizontal(-1);
    book.erase(true);
    assert.equal(book.current.source, 'A界e\u0301Z');
    book.erase(true);
    assert.equal(book.current.source, 'A界Z');
    book.undo();
    assert.equal(book.current.source, 'A界e\u0301Z');
    book.undo(true);
    assert.equal(book.current.source, 'A界Z');
});

test('typing compound operators does not split them; a comma in text remains literal', () => {
    const book = new Notebook();
    for (const character of 'A += 1') book.insert(character, true);
    assert.equal(book.current.source, 'A += 1');
    book.replace('S = "one');
    book.insert(',', true);
    assert.equal(book.current.source, 'S = "one,');
    book.replace('A *');
    book.insert(',', true);
    assert.equal(book.current.source, 'A *=');
});

test('completion has one replaceable suggestion and is dismissed without execution', t => {
    const { repl, book } = setup(t);
    book.replace('use ');
    repl.complete();
    const first = book.current.source;
    assert.match(repl.suggestion, /^Tab:/);
    repl.complete();
    assert.notEqual(book.current.source, first);
    assert.equal(repl.suggestion.split('Tab:').length - 1, 1);
    repl.dismiss();
    assert.equal(repl.suggestion, '');
    book.replace('option Limit integ');
    repl.complete();
    assert.equal(book.current.source, 'option Limit integer ');
    book.replace('N mul');
    repl.complete();
    assert.equal(book.current.source, 'N multiple by ');
});

test('commands do not replay as side effects or enter saved program text', async t => {
    const { book, enter, edit } = setup(t);
    await enter('A = 1');
    await enter('vars');
    assert.equal(book.cells[1].command, true);
    const previous = output(book.cells[1]);
    edit(0, 'A = 2');
    await enter('');
    assert.equal(output(book.cells[1]), previous);
    assert.deepEqual(book.fileLines(), ['A = 2']);
});

test('an error in multiline source focuses the end of the failing line', async t => {
    const { book, enter } = setup(t);
    await enter('if true\n  A = Missing\nend');
    assert.equal(book.active, 0);
    assert.equal(book.cursor, book.current.source.indexOf('\nend'));
});

test('replaying a generator consumer uses retained values without repeating earlier effects', async t => {
    const { book, enter, edit } = setup(t);
    await enter('use io');
    await enter('use sequences');
    await enter('fun logged N\n  N print\n  yield N\n  yield N + 1\nend');
    await enter('G = 3 logged');
    await enter('A = G array');
    edit(4, 'B = G array');
    await enter('');
    assert.equal(output(book.cells[4]), '3 4');
    assert.equal(output(book.cells[3]).split('3\n').length - 1, 1);
    assert.equal(book.dirtyFrom, -1);
});

test('a generator name displays its current unread tail and is empty after consumption', async t => {
    const { book, enter } = setup(t);
    await enter('use numbers');
    await enter('fun tst\n  yield 1\n  yield 2\n  yield 3\nend');
    await enter('G = tst');
    assert.equal(output(book.cells[2]), '1 2 3');
    await enter('G 0');
    await enter('G');
    assert.equal(output(book.cells[4]), '2 3');
    await enter('G = tst');
    await enter('G sum');
    assert.equal(output(book.cells[6]), '6');
    await enter('G');
    assert.equal(output(book.cells[7]), '');
    assert.equal(book.cells[7].status, 'ok');
    assert.equal(book.dirtyFrom, -1);
});

test('save excludes its own command and remains available while replay has an error', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-save-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const { book, enter } = setup(t);
    await enter('A = Missing');
    const target = path.join(directory, 'session.ra');
    await enter(`save ${target}`);
    assert.equal(await fs.readFile(target, 'utf8'), 'A = Missing\n');
    assert.equal(book.cells[0].status, 'error');
    assert.equal(book.dirtyFrom, 0);
});

test('loaded source is formatted on Enter and save preserves the formatted source', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-load-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const source = 'A = 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12';
    const input = path.join(directory, 'wide.ra');
    const target = path.join(directory, 'saved.ra');
    await fs.writeFile(input, source);
    const { book, enter, edit } = setup(t);
    await enter(`load ${input}`);
    assert.equal(book.cells[0].source, source);
    assert.equal(output(book.cells[0]), '');
    await enter('');
    assert.equal(book.cells[0].source, formatSource(source));
    assert.equal(book.cells[0].command, false);
    edit(0, source + ' + 1');
    await enter('');
    assert.equal(output(book.cells[0]), '79');
    await enter(`save ${target}`);
    assert.equal(await fs.readFile(target, 'utf8'), formatSource(source + ' + 1') + '\n');
});

test('help does not add a cell or replay pending edits', async t => {
    const { book, repl, enter, edit } = setup(t);
    await enter('A = 1');
    edit(0, 'A = Missing');
    await enter('help');
    assert.match(repl.help.text, /Editing/);
    assert.equal(book.cells.length, 2);
    assert.deepEqual(book.fileLines(), ['A = Missing']);
    assert.equal(output(book.cells[0]), '1');
    assert.equal(book.dirtyFrom, 0);
    assert.equal(book.current.source, '');
});

test('save/load separates instructions and keeps only source, including blanks and whole blocks', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-roundtrip-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const original = path.join(directory, 'original.ra');
    const saved = path.join(directory, 'saved.ra');
    const instructions = ['use io', 'use numbers', '', 'fun twice X\n  return X * 2\nend', '', 'A = 21 twice', 'A print'];
    const source = instructions.join('\n') + '\n';
    await fs.writeFile(original, source);
    const { book, enter, edit, repl } = setup(t);
    await enter(`load ${original}`);
    assert.deepEqual(book.cells.slice(0, -1).map(cell => cell.source), instructions);
    assert.ok(book.cells.every(cell => cell.output.length === 0));
    assert.equal(book.dirtyFrom, 0);
    assert.equal(book.atPrompt, true);
    const count = book.cells.length;
    await enter('');
    assert.equal(book.cells.length, count, 'starting a loaded program must not add a blank line');
    assert.equal(output(book.cells[5]), '42');
    assert.equal(output(book.cells[6]), '42\n42');
    await enter('vars');
    await enter('full');
    await enter(`save ${saved}`);
    assert.equal(await fs.readFile(saved, 'utf8'), source);
    edit(5, 'A = 11 twice');
    await repl.submit(true);
    assert.equal(output(book.cells[5]), '22');
    assert.equal(output(book.cells[6]), '22\n22');
    assert.equal(book.cells[0].status, 'ok');
});

test('a loaded program waits for Enter, then stops at its first error', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-load-error-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const original = path.join(directory, 'broken.ra');
    await fs.writeFile(original, 'A = 1\nB = Missing\n\nC = A + 2\n');
    const { book, enter, repl } = setup(t);
    await enter(`load ${original}`);
    assert.equal(book.atPrompt, true);
    assert.ok(book.cells.every(cell => cell.status === 'idle'));
    assert.ok(book.cells.every(cell => cell.output.length === 0));
    await enter('');
    assert.equal(book.active, 1);
    assert.equal(book.cursor, 'B = Missing'.length);
    assert.equal(book.cells[0].status, 'ok');
    assert.equal(book.cells[1].status, 'error');
    assert.equal(book.cells[3].executed, undefined);
    book.replace('B = 2');
    await repl.submit(true);
    assert.equal(output(book.cells[3]), '3');
    assert.equal(book.dirtyFrom, -1);
});

test('load completion offers directories and Rank files and loads a selected path with spaces', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-paths-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.mkdir(path.join(directory, 'folder'));
    await fs.writeFile(path.join(directory, 'file one.ra'), 'A = 7\n');
    await fs.writeFile(path.join(directory, 'other.txt'), 'not code');
    const { repl, book, enter } = setup(t);
    const [candidates, typed] = repl.session.complete(`load ${directory}/`);
    assert.equal(typed, `${directory}/`);
    assert.deepEqual(candidates, [`${directory}/folder/`, `${directory}/file one.ra`]);
    book.replace(`load ${directory}/fi`);
    repl.complete();
    assert.equal(book.current.source, `load ${directory}/file one.ra`);
    await repl.submit();
    assert.equal(book.cells[0].source, 'A = 7');
    assert.equal(book.cells[0].executed, undefined);
    await enter('');
    assert.equal(output(book.cells[0]), '7');
    assert.deepEqual(repl.session.complete(`load ${directory}/missing/`)[0], []);
    await enter(`load "${directory}/file one.ra"`);
    assert.equal(book.cells.length, 2);
    assert.equal(book.cells[0].executed, undefined);
    await enter('');
    assert.equal(output(book.cells[0]), '7');
});

test('exit asks about source changes, including an unsubmitted draft, and excludes exit commands', async t => {
    const { repl, book, enter } = setup(t);
    assert.equal(repl.requestExit(), true);
    book.replace('A = 1');
    assert.equal(repl.unsaved, true);
    assert.equal(repl.requestExit(), false);
    assert.equal(repl.savePrompt.choosing, true);
    repl.savePrompt = undefined;
    assert.equal(book.current.source, 'A = 1');
    await repl.submit();
    const count = book.cells.length;
    assert.equal(await enter('exit'), false);
    assert.equal(book.cells.length, count);
    assert.deepEqual(book.fileLines(), ['A = 1']);
    assert.equal(repl.savePrompt.exitAfterSave, true);
});

test('Ctrl-S binding tracks load/save, edits, undo and unsent source independently of execution', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-save-state-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'loaded.ra');
    await fs.writeFile(file, 'A = 1\n');
    const { repl, book, enter, edit } = setup(t);
    await enter(`load ${file}`);
    assert.equal(repl.unsaved, false);
    assert.equal(repl.requestExit(), true);
    assert.match(repl.fileStatus, /loaded.ra · saved/);
    edit(0, 'A = 3');
    assert.equal(repl.unsaved, true);
    book.undo();
    assert.equal(repl.unsaved, false);
    edit(0, 'A = Missing');
    await repl.requestSave();
    assert.equal(repl.savePrompt, undefined);
    assert.equal(repl.unsaved, false);
    assert.equal(book.active, 0);
    assert.equal(output(book.cells[0]), '', 'loading and saving must not execute code');
    assert.equal(await fs.readFile(file, 'utf8'), 'A = Missing\n');
    book.toPrompt();
    book.replace('B = 4');
    assert.equal(repl.unsaved, true);
    await repl.requestSave();
    assert.equal(await fs.readFile(file, 'utf8'), 'A = Missing\nB = 4\n');
    assert.equal(book.current.source, 'B = 4');
    assert.equal(repl.unsaved, false);
    await enter(`save ${path.join(directory, 'other')}`);
    assert.match(repl.fileStatus, /other.ra · saved/);
    assert.equal(repl.requestExit(), true);
});

test('failed saving keeps the exit dialog and source, and successful retry saves only code', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-exit-save-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const { repl, book, enter } = setup(t);
    await enter('A = Missing');
    assert.equal(repl.requestExit(), false);
    repl.savePrompt.choosing = false;
    repl.savePrompt.filename.replace(path.join(directory, 'absent', 'file.ra'));
    assert.equal(await repl.savePromptFile(), false);
    assert.match(repl.savePrompt.error, /ENOENT/);
    assert.equal(repl.unsaved, true);
    assert.equal(book.active, 0);
    repl.savePrompt.filename.replace(path.join(directory, 'program'));
    assert.equal(await repl.savePromptFile(), true);
    assert.equal(await fs.readFile(path.join(directory, 'program.ra'), 'utf8'), 'A = Missing\n');
    assert.equal(repl.unsaved, false);
});

test('replaying an edited declaration replaces its type and removes renamed or deleted bindings', async t => {
    const { repl, book, enter, edit } = setup(t);
    await enter('Count = 1');
    await enter('Count += 1');
    await enter('X = 1');
    edit(2, 'X = array 1 2 3');
    await enter('');
    assert.equal(output(book.cells[2]), '1 2 3');
    assert.equal(book.cells[2].status, 'ok');
    await enter('Count');
    assert.equal(output(book.cells[3]), '2', 'prefix state must survive');
    edit(2, 'Y = "new"');
    await enter('');
    const missingX = await repl.session.execute('X', 100, []);
    assert.equal(missingX.ok, false);
    assert.match(missingX.output[0].text, /unknown name: X/);
    edit(2, '');
    await enter('');
    assert.equal((await repl.session.execute('Y', 101, [])).ok, false);
});

test('a later assignment still respects the type declared above the replay boundary', async t => {
    const { book, enter, edit } = setup(t);
    await enter('X = 1');
    await enter('X = 2');
    edit(1, 'X = array 1 2 3');
    await enter('');
    assert.equal(book.cells[1].status, 'error');
    assert.match(output(book.cells[1]), /X has type integer/);
});

test('declarations made before an error are removed when that instruction is corrected', async t => {
    const { book, enter, edit } = setup(t);
    await enter('X = 1\nMissing');
    assert.equal(book.cells[0].status, 'error');
    edit(0, 'X = array 1 2 3');
    await enter('');
    assert.equal(book.cells[0].status, 'ok');
    assert.equal(output(book.cells[0]), '1 2 3');
});

test('load can cancel or discard changes and resets globals, functions, modules, types and undo', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-replace-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'new.ra');
    await fs.writeFile(file, 'X = array 1 2 3\n');
    const { repl, book, enter, edit } = setup(t);
    await enter('use numbers');
    await enter('X = 1');
    await enter('fun oldfn A\n  return A + 1\nend');
    edit(1, 'X = 2');
    await enter(`load ${file}`);
    assert.equal(repl.savePrompt.loadFile.path, file);
    assert.equal(repl.session.savedFile, undefined, 'staging a load must not change the old save target');
    assert.deepEqual(book.fileLines(), ['use numbers', 'X = 2', 'fun oldfn A', '  return A + 1', 'end']);
    repl.savePrompt = undefined; // Esc
    assert.equal((await repl.session.execute('X', 100, [])).output[0].text, '1');
    await enter(`load ${file}`);
    assert.equal(repl.discardChanges(), false, 'discarding for load must not exit');
    assert.deepEqual(book.fileLines(), ['X = array 1 2 3']);
    assert.equal(book.atPrompt, true);
    assert.equal(repl.unsaved, false);
    assert.ok(book.cells.every(cell => cell.output.length === 0));
    assert.equal((await repl.session.execute('X', 100, [])).ok, false);
    assert.equal((await repl.session.execute('1 oldfn', 101, [])).ok, false);
    assert.equal((await repl.session.execute('9 sqrt', 102, [])).ok, false);
    assert.match((await repl.session.execute('full', 103, [])).output[0].text, /no result/);
    book.active = 0; book.undo();
    assert.equal(book.current.source, 'X = array 1 2 3');
    await enter('');
    assert.equal(book.cells[0].status, 'ok');
    assert.equal(output(book.cells[0]), '1 2 3');
});

test('load saves the old document to its bound file before replacing it; a missing file leaves it intact', async t => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-save-replace-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const old = path.join(directory, 'old.ra');
    const next = path.join(directory, 'next.ra');
    await fs.writeFile(old, 'X = 1\n');
    await fs.writeFile(next, 'X = "text"\n');
    const { repl, book, enter, edit } = setup(t);
    await enter(`load ${old}`);
    await enter('');
    edit(0, 'X = 2');
    await enter(`load ${directory}/missing.ra`);
    assert.equal(repl.session.savedFile.path, old);
    assert.equal(book.cells[0].source, 'X = 2');
    assert.equal((await repl.session.execute('X', 100, [])).output[0].text, '1');
    await enter(`load ${next}`);
    assert.equal(repl.savePrompt.filename.current.source, old);
    repl.savePrompt.filename.replace(path.join(directory, 'missing', 'old.ra'));
    assert.equal(await repl.savePromptFile(), false);
    assert.match(repl.savePrompt.error, /ENOENT/);
    assert.equal(book.cells[0].source, 'X = 2');
    assert.equal(repl.session.savedFile.path, old);
    repl.savePrompt.filename.replace(old);
    assert.equal(await repl.savePromptFile(), false);
    assert.equal(await fs.readFile(old, 'utf8'), 'X = 2\n');
    assert.deepEqual(book.fileLines(), ['X = "text"']);
    assert.equal(repl.session.savedFile.path, next);
    await enter('');
    assert.equal(output(book.cells[0]), 'text');
    edit(0, 'X = "updated"');
    await enter(`load ${next}`);
    await repl.savePromptFile();
    assert.deepEqual(book.fileLines(), ['X = "updated"'], 'reloading the save target must read the saved version');
    assert.equal(repl.unsaved, false);
});

test('editing a native stream consumer restores its position while retaining earlier consumption', async t => {
    const { book, enter, edit } = setup(t);
    await enter('use sequences');
    await enter('G = primes');
    await enter('G until 100 sum');
    await enter('G until 120 sum');
    await enter('G');
    assert.equal(output(book.cells[2]), '1060');
    assert.equal(output(book.cells[3]), '533');
    assert.match(output(book.cells[4]), /^127 131 137/);
    edit(3, 'G until 110 sum');
    await enter('');
    assert.equal(output(book.cells[3]), '420');
    assert.match(output(book.cells[4]), /^113 127 131/);
    edit(2, 'G until 10 sum');
    await enter('');
    assert.equal(output(book.cells[2]), '17');
    assert.match(output(book.cells[4]), /^113 127 131/);
});
