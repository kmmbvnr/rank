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
const running = keys => ({ keys, until: 'Running' });
const paused = keys => ({ keys, until: 'Paused' });

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
        'match_max 100000',
        'set screen ""',
        'proc read_frame {seconds} {',
        '    global screen spawn_id',
        '    expect -timeout $seconds -re ".+" {',
        '        append screen $expect_out(0,string)',
        // drawFrame starts each screen with ESC[?25l (hide cursor).
        '        set start [string last [binary format H* 1b5b3f32356c] $screen]',
        '        if {$start >= 0} { set screen [string range $screen $start end] }',
        '        exp_continue -continue_timer',
        '    } eof {} timeout {}',
        '}',
        ...steps.flatMap((step, index) => {
            const { keys, until } = typeof step === 'string' ? { keys: step } : step;
            // Ordinary gestures wait for execution to finish. Tests of cancellation
            // and debugging explicitly wait for the running or paused screen.
            const waiting = until ? `![regexp {${until}} $screen]`
                : '$screen eq "" || [regexp {(Running|Stopping|Pausing)} $screen]';
            return [
                ...(until || /[\r\x12\x14\x10\x07\x0e]/.test(keys) || /^[tng]$/.test(keys)
                    ? ['set screen ""'] : []),
                `send -- [binary format H* {${Buffer.from(keys).toString('hex')}}]`,
                'read_frame 1',
                'set deadline [expr {[clock milliseconds] + 10000}]',
                `while {(${waiting}) && [clock milliseconds] < $deadline} { read_frame 1 }`,
                `if {${waiting}} { error "terminal did not settle at step ${index}: $screen" }`,
                `send_user "<<<FRAME:${index}>>>"`,
            ];
        }),
        'catch {send -- [binary format H* 11]}',
        'sleep 0.2',
        'catch {send -- [binary format H* 64]}',
        'sleep 0.2',
        'catch {expect eof}',
        'catch wait status',
        'send_user "<<<EXIT:[lindex $status 3]>>>"',
    ].join('\n'));
    const result = spawnSync('expect', ['-f', script], { encoding: 'utf8', timeout: (steps.length + 10) * 2000, killSignal: 'SIGKILL', maxBuffer: 5 * 1024 * 1024 });
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
            raw: chunk,
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
        { keys: `load ${target}` + ENTER, until: '· saved' },
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
        'X = 1' + ENTER,
        { keys: `load ${target}` + ENTER, until: 'Save changes before loading another file' },
        '\x1b',
        { keys: ENTER, until: 'Save changes before loading another file' },
        { keys: 'd', until: '· saved' },
        ENTER,
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
        running('Factors = 170141183460469231731687303715884105727 factors' + ENTER),
        running(UP),
        '\x03',
        'A + 1' + ENTER,
    ]);
    assert.match(frames[3].text, /Running.*[0-9]\.[0-9]s.*\^C stop.*\^P pause/);
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
        running(`Db ${JSON.stringify(sql)} (array shape 0 pad 0) sqlquery array` + ENTER),
        running(UP),
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


test('Ctrl-P shows factor state and Enter continues in the real terminal', async t => {
    const frames = await drive(t, [
        'use numbers' + ENTER,
        running('170141183460469231731687303715884105727 factors max' + ENTER),
        '\x10',
        running(ENTER),
        '\x10',
        '\x03',
        '21 * 2' + ENTER,
    ], 100, 24);
    assert.match(frames[2].text, /Paused.*searching factors/);
    assert.match(frames[2].text, /divisor: [0-9]+/);
    assert.match(frames[2].text, /remaining: 170141183460469231731687303715884105727/);
    assert.match(frames[3].text, /Running/);
    assert.match(frames[4].text, /Paused/);
    assert.match(frames[5].text, /Stopped after/);
    assert.match(frames[6].text, /\n      42\n/);
});

test('Ctrl-T steps a short cell and Ctrl-B sets a visible breakpoint in the terminal', async t => {
    const frames = await drive(t, [
        paused('A = 1\x14'), // Ctrl-T
        '\x14',
        UP + '\x02', // Ctrl-B
        '\x14',
        '\x03',
        '21 * 2' + ENTER,
    ], 100, 24);
    assert.match(frames[0].text, /Paused.*before line 1/);
    assert.match(frames[0].text, /t step · n loop · g main · ↵ · \^C stop/);
    assert.match(frames[0].text, /● 1 │ A = 1/);
    assert.doesNotMatch(frames[1].text, /Paused/);
    assert.match(frames[2].text, /◆/);
    assert.match(frames[3].text, /Paused/);
    assert.match(frames[4].text, /Stopped after/);
    assert.match(frames[5].text, /\n      42\n/);
});

test('an unknown debugger key is reported in the pause footer', async t => {
    const frames = await drive(t, [
        paused('A = 1\x14'),
        'x',
        ENTER,
    ], 100, 24);
    assert.equal(frames[1].text.split('\n').at(-1).trim(), 'Unknown key: x');
    assert.match(frames[2].text, /\n      1\n/);
});

test('an open function evaluates body lines immediately on example arguments', async t => {
    const frames = await drive(t, [
        'fun inc N' + ENTER,
        '2' + ENTER,
        'A = N + 1' + ENTER,
        'A * 2' + ENTER,
        'end' + ENTER,
    ], 100, 30);
    assert.match(frames[0].text, /rank> fun inc N\n\s+N = /);
    assert.match(frames[0].text, /N = /);
    assert.match(frames[0].text, /Example inc · N \(1\/1\)/);
    assert.equal(frames[0].cursorX, 10, 'argument cursor belongs immediately after N =');
    assert.match(frames[1].text, /fun inc N/);
    assert.match(frames[1].text, /fun inc N\n\s+N = 2/);
    assert.doesNotMatch(frames[1].text, /●/);
    assert.match(frames[2].text, /A = N \+ 1\n        3/);
    assert.match(frames[2].text, /fun inc N\n\s+N = 2/);
    assert.match(frames[3].text, /A \* 2\n        6/);
    assert.doesNotMatch(frames[2].text + frames[3].text, /Paused/);
    assert.match(frames[4].text, /●\s*1› fun inc N/);
    assert.match(frames[4].text, /<function inc>/);
});

test('arrow keys edit visible function arguments and return to them from the body', async t => {
    const frames = await drive(t, [
        'fun add X Y' + ENTER,
        '1' + DOWN,
        '2' + UP,
        CLEAR + '3' + DOWN,
        ENTER,
        'return X + Y' + ENTER,
        UP + UP,
        CLEAR + '4' + ENTER,
        ENTER,
        'end' + ENTER,
    ], 100, 30);
    assert.match(frames[1].text, /X = 1\n\s+Y = /);
    assert.match(frames[2].text, /X = 1\n\s+Y = 2/);
    assert.match(frames[3].text, /X = 3\n\s+Y = 2/);
    assert.match(frames[5].text, /return X \+ Y\n\s+5/);
    assert.match(frames[6].text.split('\n')[frames[6].cursorY], /^\s+Y = 2/);
    assert.doesNotMatch(frames[7].text, /\n\s+7\n/, 'the selected body line waits for Enter');
    assert.match(frames[8].text, /return X \+ Y\n\s+7/);
    assert.match(frames[9].text, /<function add>/);
});

test('a live function named plus is not rewritten to an operator in its preview call', async t => {
    const frames = await drive(t, [
        'A = array 1 2 3' + ENTER,
        'fun plus X Y' + ENTER,
        'A' + ENTER,
        'A+1' + ENTER,
        'return X + Y -1' + ENTER,
    ], 100, 24);
    assert.match(frames[4].text, /return X \+ Y -\s?1\n\s+2 4 6/);
    assert.doesNotMatch(frames[4].text, /error:|\(A\) \(A \+ 1\) \+/);
});

test('Esc skips a function example without adding its draft to the program', async t => {
    const frames = await drive(t, [
        'fun twice X' + ENTER,
        '21',
        '\x1b',
        'return X * 2' + ENTER,
        'end' + ENTER,
        '4 twice' + ENTER,
    ], 80, 20);
    assert.match(frames[0].text, /Example twice/);
    assert.match(frames[1].text, /X = 21/);
    assert.match(frames[2].text, /fun twice X/);
    assert.doesNotMatch(frames[3].text, /\n\s+42\n/);
    assert.match(frames[5].text, /\n      8\n/);
});

test('an invalid function example reports syntax at its field and stays editable', async t => {
    const frames = await drive(t, [
        'A = 1' + ENTER,
        'fun inc X' + ENTER,
        'A = 1' + ENTER,
        CLEAR + 'A' + ENTER,
    ], 80, 20);
    assert.match(frames[2].text, /X = A = 1\n\s+! Syntax: Expecting token/);
    assert.match(frames[2].text.split('\n')[frames[2].cursorY], /X = A = 1/);
    assert.doesNotMatch(frames[2].text, /return X|<function inc>/);
    assert.match(frames[3].text, /X = A/);
    assert.doesNotMatch(frames[3].text, /! Syntax:/);
});

test('a runtime error in a function example stays on its argument field', async t => {
    const frames = await drive(t, [
        'fun family Prime Pick' + ENTER,
        '123123' + ENTER,
        '0 1 2' + ENTER,
        CLEAR + 'array 0 1 2' + ENTER,
    ], 100, 20);
    assert.match(frames[2].text, /Pick = 0 1 2\n\s+! Runtime: value application requires a sequence and one selector/);
    assert.match(frames[2].text.split('\n')[frames[2].cursorY], /Pick = 0 1 2/);
    assert.doesNotMatch(frames[2].text, /\(123123\) \(0 1 2\) family|<repl>:\d+:/);
    assert.match(frames[3].text, /Pick = array 0 1 2/);
    assert.doesNotMatch(frames[3].text, /! Runtime:/);
});

test('fixing func to fun turns the failed cell into live function input', async t => {
    const frames = await drive(t, [
        'func inc2 Y' + ENTER,
        CLEAR + 'fun inc2 Y' + ENTER,
        '\x1b',
    ], 80, 18);
    assert.match(frames[0].text, /unknown name: func/);
    assert.match(frames[1].text, /●\s*1› fun inc2 Y\n\s+Y = /);
    assert.match(frames[1].text, /Example inc2 · Y \(1\/1\)/);
    assert.doesNotMatch(frames[1].text, /unknown name: func/);
    assert.match(frames[1].text.split('\n')[frames[1].cursorY], /Y = /);
});

test('Ctrl-R reruns an unfinished function and leaves it open at the current line', async t => {
    const frames = await drive(t, [
        'fun inc N' + ENTER,
        '4' + ENTER,
        'Result = N + 1',
        '\x12',
        ENTER,
        ENTER,
        'return Result' + ENTER,
        'end' + ENTER,
    ], 80, 20);
    assert.match(frames[3].text, /Result = N \+ 1/);
    assert.match(frames[3].text, /N = 4/);
    assert.match(frames[3].text, /Example inc · N \(1\/1\)/);
    assert.doesNotMatch(frames[3].text, /Result = N \+ 1\n        5/);
    assert.doesNotMatch(frames[3].text, /<function inc>|●\s*1›/);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /Result = N \+ 1/);
    assert.doesNotMatch(frames[4].text, /Result = N \+ 1\n        5/);
    assert.match(frames[5].text, /Result = N \+ 1\n        5/);
    assert.match(frames[6].text, /return Result\n        5/);
    assert.match(frames[7].text, /<function inc>/);
});

test('Enter on an empty live-function line preserves a blank without inserting end', async t => {
    const frames = await drive(t, [
        'fun inc X' + ENTER,
        '1' + ENTER,
        'return X + 1' + ENTER,
        ENTER,
        'return X + 2',
    ], 80, 20);
    assert.match(frames[3].text, /return X \+ 1\n        2/);
    assert.match(frames[3].text, /Live inc\(1\)/);
    assert.doesNotMatch(frames[3].text, /<function inc>|\n\s*end\s*\n/);
    assert.match(frames[3].text.split('\n')[frames[3].cursorY], /^\s*$/);
    assert.match(frames[4].text, /return X \+ 1\n        2\n        \n    ·   return X \+ 2/);
});

test('Enter reevaluates an edited function line without inserting end', async t => {
    const frames = await drive(t, [
        'fun inc X' + ENTER,
        '1' + ENTER,
        'Result = X + 1' + ENTER,
        UP + END + '\x7f' + '2' + ENTER,
        'return Result' + ENTER,
        'end' + ENTER,
    ], 80, 20);
    assert.match(frames[3].text, /Result = X \+ 2\n        3/);
    assert.doesNotMatch(frames[3].text, /<function inc>|●\s*1›|\n\s*end\s*\n/);
    assert.match(frames[4].text, /return Result\n        3/);
    assert.match(frames[5].text, /<function inc>/);
});

test('a live eval error keeps the terminal cursor on the erroneous line', async t => {
    const frames = await drive(t, [
        'fun inc X' + ENTER,
        '1' + ENTER,
        'resutl = X + 2' + ENTER,
    ], 80, 20);
    const frame = frames[2];
    assert.match(frame.text, /error: RankError \[Syntax\]/);
    assert.match(frame.text.split('\n')[frame.cursorY], /resutl = X \+ 2/);
    assert.doesNotMatch(frame.text, /<function inc>/);
});

test('Ctrl-R reopens a completed function at the selected line with its old example', async t => {
    const frames = await drive(t, [
        'fun inc X' + ENTER,
        '2' + ENTER,
        'Result = X + 1' + ENTER,
        'Result *= 2' + ENTER,
        'end' + ENTER,
        UP + UP + '\x12',
        ENTER,
        ENTER,
    ], 80, 22);
    assert.match(frames[5].text, /●\s*1› fun inc X\n\s+X = 2/);
    assert.match(frames[5].text, /Example inc · X \(1\/1\)/);
    assert.match(frames[5].text.split('\n')[frames[5].cursorY], /X = 2/);
    assert.doesNotMatch(frames[5].text, /<function inc>/);
    assert.match(frames[6].text, /Result = X \+ 1\n        3/);
    assert.doesNotMatch(frames[6].text, /Result \*= 2\n        6/);
    assert.match(frames[6].text.split('\n')[frames[6].cursorY], /Result \*= 2/);
    assert.match(frames[7].text, /Result \*= 2\n        6/);
});


test('Ctrl-N advances an iteration while paused and still recalls history in the editor', async t => {
    const frames = await drive(t, [
        '\x1b[200~Total = 0\nfor I in 1 to 3\n  Total += I\nend\nTotal\x1b[201~',
        paused('\x14'),
        '\x14',
        '\x14',
        '\x0e', // Ctrl-N: second iteration
        ENTER,
        '21 * 2' + ENTER,
        'Draft',
        '\x10', // Ctrl-P: recall history
        '\x0e', // Ctrl-N: restore draft
    ], 100, 30);
    assert.match(frames[3].text, /I = 1/);
    assert.match(frames[4].text, /I = 2/);
    assert.match(frames[4].text, /Total = 1/);
    assert.match(frames[4].text, /● 2 │ for I in 1 to 3/);
    assert.match(frames[4].text, /3 │   Total \+= I/);
    assert.doesNotMatch(frames[4].raw, /Running…|rank> /, 'iteration must not flash the notebook');
    assert.match(frames[5].text, /\n      6\n/);
    assert.match(frames[8].text, /rank> 21 \* 2/);
    assert.match(frames[9].text, /rank> Draft/);
});

test('Ctrl-G finishes the loop and stops on the next main line in the terminal', async t => {
    const frames = await drive(t, [
        '\x1b[200~Total = 0\nfor I in 1 to 5\n  Total += I\nend\nTotal\x1b[201~',
        UP + UP + '\x02',
        ENTER,
        '',
        '\x07',
        '',
        ENTER,
        '\x03',
    ], 100, 30);
    assert.match(frames[3].text, /Paused/);
    assert.match(frames[3].text, /I = 1/);
    assert.match(frames[5].text, /Paused · before line 5/);
    assert.match(frames[5].text, /Total = 15/);
    assert.doesNotMatch(frames[4].raw + frames[5].raw, /Running…|rank> /);
    assert.match(frames[6].text, /\n      15\n/);
});

test('plain t n g control paused execution and remain ordinary editor text', async t => {
    const frames = await drive(t, [
        '\x1b[200~Total = 0\nfor I in 1 to 3\n  Total += I\nend\nTotal\x1b[201~',
        paused('\x14'),
        't',
        't',
        'n',
        'g',
        ENTER,
        'tng',
        CLEAR,
    ], 100, 30);
    assert.match(frames[2].text, /Paused · before line 2/);
    assert.match(frames[3].text, /I = 1/);
    assert.match(frames[4].text, /I = 2/);
    assert.match(frames[5].text, /Paused · before line 5/);
    assert.match(frames[5].text, /Total = 6/);
    assert.match(frames[6].text, /\n      6\n/);
    assert.match(frames[7].text, /rank> tng/);
});

test('loaded function below its call is available without executing the file on load', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-load-forward-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'forward.ra');
    fs.writeFileSync(target, 'Answer = 21 twice\nfun twice X\n  return X + X\nend\n');
    const frames = await drive(t, [`load ${target}` + ENTER, 'twi\t', CLEAR + ENTER]);
    assert.doesNotMatch(frames[0].text, /\n      42\n|error:/);
    assert.match(frames[1].text, /rank> twice /);
    assert.match(frames[2].text, /Answer = 21 twice\n      42\n/);
    assert.doesNotMatch(frames[2].text, /unknown name|error:/);
});

test('debugging a loaded file uses document line numbers for cells and function calls', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-debug-lines-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'forward.ra');
    fs.writeFileSync(target, 'rem Example\n\nAnswer = 21 twice\n\nfun twice X\n  return X + X\nend\n');
    const frames = await drive(t, [
        `load ${target}` + ENTER,
        ENTER,
        paused(UP + UP + UP + UP + UP + '\x14'),
        '\x14',
        ENTER,
        '\x03',
    ], 100, 30);
    assert.match(frames[2].text, /Paused · before line 3/);
    assert.match(frames[2].text, /● 3 │ Answer = 21 twice/);
    assert.match(frames[2].text, /1 │ rem Example/);
    assert.match(frames[3].text, /Paused · before line 6/);
    assert.match(frames[3].text, /● 6 │   return X \+ X/);
    assert.match(frames[3].text, /5 │ fun twice X/);
    assert.ok(frames[3].text.indexOf('Call stack') < frames[3].text.indexOf('● 6 │'));
    assert.ok(frames[3].text.indexOf('Variables (current scope)') > frames[3].text.indexOf('● 6 │'));
    assert.doesNotMatch(frames[3].text, /<repl>:/);
});
