import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import xterm from '@xterm/headless';
import Database from 'better-sqlite3';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const { Terminal } = xterm;
const UP = '\x1b[A', DOWN = '\x1b[B', CLEAR = '\x15', ENTER = '\r', END = '\x05';

/** Feed a real PTY to a terminal emulator and inspect its visible cells after each gesture. */
async function drive(t, steps, columns = 60, rows = 18) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-notebook-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const preload = path.join(directory, 'home.mjs');
    fs.writeFileSync(preload, `import os from 'node:os';\nimport { syncBuiltinESMExports } from 'node:module';\nos.homedir = () => ${JSON.stringify(directory)};\nsyncBuiltinESMExports();\n`);
    const script = path.join(directory, 'session.exp');
    fs.writeFileSync(script, [
        'set timeout 10',
        `set stty_init "rows ${rows} columns ${columns}"`,
        `spawn -noecho ${process.execPath} --import ${preload} ${cli}`,
        'expect "rank> "',
        'expect_background { -re ".+" {} }',
        ...steps.flatMap((step, index) => [
            `send -- [binary format H* {${Buffer.from(step).toString('hex')}}]`,
            `sleep ${step === '\x1b' ? 0.6 : 0.2}`,
            `send_user "<<<FRAME:${index}>>>"`,
        ]),
        'catch {send -- [binary format H* 11]}',
        'sleep 0.2',
        'catch {send -- [binary format H* 64]}',
        'sleep 0.2',
        'catch wait status',
        'send_user "<<<EXIT:[lindex $status 3]>>>"',
    ].join('\n'));
    const result = spawnSync('expect', ['-f', script], { encoding: 'utf8', timeout: 20000, maxBuffer: 5 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /<<<EXIT:0>>>/);
    assert.match(result.stdout, /\x1b\[\?1049l/, 'alternate screen was not restored');
    const terminal = new Terminal({ cols: columns, rows, allowProposedApi: true });
    t.after(() => terminal.dispose());
    const frames = [];
    const chunks = result.stdout.split(/<<<FRAME:\d+>>>/);
    for (const chunk of chunks.slice(0, steps.length)) {
        await new Promise(resolve => terminal.write(chunk, resolve));
        frames.push({
            text: Array.from({ length: rows }, (_, i) => terminal.buffer.active.getLine(i).translateToString(true)).join('\n'),
            cursorX: terminal.buffer.active.cursorX, cursorY: terminal.buffer.active.cursorY,
        });
    }
    return frames;
}

test('real keyboard edits an old instruction, stops at its error, then resumes without losing new input', async t => {
    const frames = await drive(t, [
        'A = 1' + ENTER,
        'B = A + 1' + ENTER,
        UP + UP + END + CLEAR + 'A = Missing',
        DOWN + DOWN,
        'C = B + 1' + ENTER,
        END + CLEAR + 'A = 8',
        DOWN + DOWN + DOWN,
        ENTER,
    ]);
    assert.match(frames[1].text, /B = A \+ 1/);
    assert.match(frames[4].text, /unknown name/);
    assert.match(frames[4].text, /C = B \+ 1/);
    assert.equal(frames[4].cursorY, 0);
    assert.doesNotMatch(frames[7].text, /unknown name/);
    assert.match(frames[7].text, /\n      10\n/);
    assert.match(frames[7].text.split('\n')[frames[7].cursorY], /^rank> /);
    assert.equal(frames[7].cursorY, 6, 'empty Enter must not insert a blank row before the prompt');
});

test('real keyboard navigates wrapped rows and edits the intended character', async t => {
    const source = 'S = "abcdefghijklmnopqrstuvwxyz0123456789"';
    const frames = await drive(t, [source, UP, '\x01', 'X', ENTER], 24, 12);
    // No source has executed: up moved within the wrapped draft, and Home found its logical start.
    assert.equal(frames[2].cursorX, 6);
    assert.equal(frames[2].cursorY, 0);
    assert.match(frames[3].text, /^rank> XS =/);
    assert.match(frames[4].text, /XS =/);
    assert.doesNotMatch(frames[4].text, /error:/);
});

test('bracketed multiline paste stays editable until Enter and tab suggestions never accumulate', async t => {
    const frames = await drive(t, [
        '\x1b[200~A = 1\nB = A + 2\x1b[201~',
        ENTER,
        'use \t',
        '\t',
        '\x15',
    ]);
    assert.match(frames[0].text, /^rank> A = 1/);
    assert.doesNotMatch(frames[0].text, /●/);
    assert.match(frames[1].text, /\n      3\n/);
    assert.equal((frames[2].text.match(/Tab:/g) ?? []).length, 1);
    assert.equal((frames[3].text.match(/Tab:/g) ?? []).length, 1);
    assert.doesNotMatch(frames[4].text, /Tab:/);
});

test('help opens outside the document and Esc removes it before returning to editing', async t => {
    const frames = await drive(t, [
        'A = 1' + ENTER,
        'help' + ENTER,
        '\x1b[6~',
        'ignored text',
        '\x1b',
        UP,
    ]);
    assert.match(frames[1].text, /^Editing\n/);
    assert.match(frames[1].text, /Esc close/);
    assert.doesNotMatch(frames[1].text, /A = 1/);
    assert.match(frames[2].text, /Esc close/);
    assert.doesNotMatch(frames[3].text, /ignored text/);
    assert.match(frames[4].text, /A = 1/);
    assert.doesNotMatch(frames[4].text.split('\n').slice(0, -1).join('\n'), /help|Esc close|ignored text/);
    assert.equal((frames[4].text.match(/●/g) ?? []).length, 1);
    assert.equal(frames[5].cursorY, 0);
    assert.equal(frames[5].cursorX, 11);
});

test('Ctrl-R reruns an edit and the footer advertises help', async t => {
    const frames = await drive(t, [
        'A = 1' + ENTER,
        UP + CLEAR + 'A = 5',
        '\x12',
    ]);
    assert.match(frames[0].text, /help/);
    assert.match(frames[1].text, /Ctrl-R rerun/);
    assert.match(frames[2].text, /\n      5\n/);
    assert.match(frames[2].text.split('\n')[frames[2].cursorY], /^rank> /);
    assert.doesNotMatch(frames[2].text, /F5/);
});

test('an error at the bottom scrolls its full diagnostic and prompt into view', async t => {
    const frames = await drive(t, [
        ...Array.from({ length: 8 }, (_, i) => `A = ${i}` + ENTER),
        'Missing' + ENTER,
    ], 70, 12);
    const frame = frames.at(-1);
    assert.match(frame.text, /unknown name/);
    assert.match(frame.text, /\^\nrank> /);
    assert.match(frame.text.split('\n')[frame.cursorY], /› Missing$/);
    assert.equal(frame.cursorX, 13);
});

test('Ctrl-Q offers saving and Esc restores the unsubmitted draft and cursor', async t => {
    const frames = await drive(t, ['A = 1' + ENTER, 'B = 2', '\x11', '\x1b']);
    assert.match(frames[1].text, /Untitled · unsaved/);
    assert.match(frames[2].text, /Save changes before exit/);
    assert.match(frames[2].text, /discard changes/);
    assert.match(frames[3].text, /rank> B = 2/);
    assert.equal(frames[3].cursorX, frames[1].cursorX);
    assert.equal(frames[3].cursorY, frames[1].cursorY);
});

test('Ctrl-S asks for a filename once, then saves to the bound file and updates status', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-save-keys-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'keys.ra');
    const frames = await drive(t, [
        'A = 1' + ENTER, '\x13', target + ENTER,
        UP + CLEAR + 'A = 9', '\x13',
    ], 80);
    assert.match(frames[1].text, /Save program/);
    assert.match(frames[2].text, /keys.ra · saved/);
    assert.match(frames[3].text, /keys.ra · unsaved/);
    assert.match(frames[4].text, /keys.ra · saved/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'A = 9\n');
    assert.equal(frames[4].cursorY, frames[3].cursorY);
});

test('exit can save the program, and quit can discard it', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-exit-keys-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'exit.ra');
    const saved = await drive(t, ['A = 7' + ENTER, 'exit' + ENTER, 's', target + ENTER]);
    assert.match(saved[1].text, /Save changes before exit/);
    assert.match(saved[2].text, /Save before exit/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'A = 7\n');
    const discarded = await drive(t, ['A = 8' + ENTER, 'quit' + ENTER, 'd']);
    assert.match(discarded[1].text, /Save changes before exit/);
});

test('saving before exit uses the loaded file without asking for its name again', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-bound-exit-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'loaded.ra');
    fs.writeFileSync(target, 'A = 1\n');
    const frames = await drive(t, [
        `load ${target}` + ENTER, UP + CLEAR + 'A = 2', '\x11', 's',
    ]);
    assert.match(frames[0].text, /loaded.ra · saved/);
    assert.match(frames[2].text, /Save changes before exit/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'A = 2\n');
});

test('load waits for Enter and lets the user edit code before the first execution', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-load-wait-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'pending.ra');
    fs.writeFileSync(target, 'A = Missing\n');
    const frames = await drive(t, [
        `load ${target}` + ENTER,
        UP + CLEAR + 'A = 42',
        DOWN + ENTER,
    ]);
    assert.match(frames[0].text, /A = Missing/);
    assert.doesNotMatch(frames[0].text, /unknown name|error:/);
    assert.match(frames[0].text.split('\n')[frames[0].cursorY], /^rank> /);
    assert.doesNotMatch(frames[1].text, /\n      42\n/);
    assert.match(frames[2].text, /A = 42\n      42\nrank> /);
});

test('load can be cancelled or replace the old document and its variable types', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-load-replace-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'array.ra');
    fs.writeFileSync(target, 'X = array 1 2 3\n');
    const frames = await drive(t, [
        'X = 1' + ENTER, `load ${target}` + ENTER, '\x1b', ENTER, 'd', ENTER,
    ], 80);
    assert.match(frames[1].text, /Save changes before loading another file/);
    assert.match(frames[2].text, /X = 1/);
    assert.match(frames[3].text, /Save changes before loading another file/);
    assert.doesNotMatch(frames[4].text, /X = 1|\n      1 2 3\n/);
    assert.match(frames[4].text, /X = array 1 2 3/);
    assert.match(frames[5].text, /\n      1 2 3\nrank> /);
    assert.doesNotMatch(frames[5].text, /cannot receive/);
});

test('editing a declaration can change its type on replay', async t => {
    const frames = await drive(t, ['X = 1' + ENTER, UP + CLEAR + 'X = array 1 2 3', DOWN + ENTER]);
    assert.match(frames[2].text, /X = array 1 2 3\n      1 2 3\nrank> /);
    assert.doesNotMatch(frames[2].text, /cannot receive/);
});


test('Ctrl-C interrupts factor search in the real terminal and keeps the session usable', async t => {
    const frames = await drive(t, [
        'use numbers' + ENTER,
        'A = 41' + ENTER,
        'Factors = 170141183460469231731687303715884105727 factors' + ENTER,
        UP,
        '\x03',
        'A + 1' + ENTER,
    ]);
    assert.match(frames[3].text, /Running.*[0-9]\.[0-9]s.*Ctrl-C stop/);
    assert.match(frames[4].text, /Stopped after/);
    assert.match(frames[4].text, /searching factors/);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /^rank> /);
    assert.match(frames[5].text, /\n      42\n/);
    assert.doesNotMatch(frames[5].text, /Running/);
});


test('Ctrl-C interrupts SQLite in the real terminal and preserves the database binding', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-sqlite-terminal-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'test.sqlite');
    const database = new Database(filename);
    database.exec('CREATE TABLE items(value INTEGER)');
    database.close();
    const sql = 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n';
    const frames = await drive(t, [
        'use tables' + ENTER,
        `Db = ${JSON.stringify(filename)} sqlite` + ENTER,
        '',
        `Db ${JSON.stringify(sql)} (array shape 0 pad 0) sqlquery array` + ENTER,
        UP,
        '\x03',
        'Rows = Db "SELECT 42 AS answer" (array shape 0 pad 0) sqlquery array' + ENTER,
        'Rows .answer' + ENTER,
    ], 100, 24);
    assert.match(frames[4].text, /Running/);
    assert.match(frames[5].text, /Stopped after/);
    assert.match(frames[5].text, /executing SQLite query/);
    assert.match(frames[7].text, /\n      42\n/);
    assert.doesNotMatch(frames[7].text, /Running/);
});
