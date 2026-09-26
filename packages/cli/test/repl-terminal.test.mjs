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
const UP = '\x1b[A', DOWN = '\x1b[B', RIGHT = '\x1b[C', CLEAR = '\x15', ENTER = '\r', END = '\x05';
const running = keys => ({ keys, until: 'Running' });
const paused = keys => ({ keys, until: 'Paused' });

/** Feed a real PTY to a terminal emulator and inspect its visible cells after each gesture. */
async function drive(t, steps, columns = 60, rows = 18) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-notebook-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const preload = path.join(directory, 'home.mjs');
    fs.writeFileSync(preload, `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
os.homedir = () => ${JSON.stringify(directory)};
syncBuiltinESMExports();
const filter = fn => (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('Ambiguous Alternatives Detected')) return;
    fn(...args);
};
console.log = filter(console.log);
console.warn = filter(console.warn);
console.error = filter(console.error);
`);
    const stepTimeout = process.env.CI ? 25 : 10;
    const script = path.join(directory, 'session.exp');
    fs.writeFileSync(script, [
        `set timeout ${stepTimeout}`,
        `set stty_init "rows ${rows} columns ${columns}"`,
        `spawn -noecho ${process.execPath} --import ${preload} ${cli}`,
        'expect "rank> "',
        'match_max 100000',
        'set screen ""',
        'proc read_frame {seconds {settled 0}} {',
        '    global screen spawn_id',
        '    set stop [expr {[clock milliseconds] + 3000}]',
        '    expect -timeout $seconds -re ".+" {',
        '        append screen $expect_out(0,string)',
        // drawFrame starts each screen with ESC[?25l (hide cursor).
        '        set start [string last [binary format H* 1b5b3f32356c] $screen]',
        '        if {$start >= 0} { set screen [string range $screen $start end] }',
        // Read until the terminal stays quiet: a loaded machine may echo the
        // typed keys well before it starts the execution they submitted.
        // A running cell redraws its timer constantly, so cap the wait.
        '        if {![expr $settled] && [clock milliseconds] < $stop} { exp_continue }',
        '    } eof {} timeout {}',
        '}',
        ...steps.flatMap((step, index) => {
            const { keys, until, early } = typeof step === 'string' ? { keys: step } : step;
            // Keys sent while a cell still runs are typed into it and lost when it
            // finishes, so a step settles only once execution has ended too.
            const busy = '[regexp {(Running|Stopping|Pausing)} $screen]';
            const waiting = !until ? `$screen eq "" || ${busy}`
                : /Running|Paused|Stopping|Pausing/.test(until) ? `![regexp {${until}} $screen]`
                : `![regexp {${until}} $screen] || ${busy}`;
            // An early step ends as soon as its awaited text shows in a whole
            // frame; drawFrame ends each screen with ESC[?25h (show cursor).
            const settled = early ? `{!(${waiting}) && [string range $screen end-5 end] eq [binary format H* 1b5b3f323568]}` : '0';
            return [
                ...(until || /[\r\t\n\x01\x11\x12\x13\x14\x10\x07\x0e\x08\x03\x02\x1b\x15]/.test(keys) || /^[tng]$/.test(keys)
                    ? ['set screen ""'] : []),
                `send -- [binary format H* {${Buffer.from(keys).toString('hex')}}]`,
                `read_frame 1 ${settled}`,
                `set deadline [expr {[clock milliseconds] + ${stepTimeout * 1000}}]`,
                `while {(${waiting}) && [clock milliseconds] < $deadline} { read_frame 1 ${settled} }`,
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
    const result = spawnSync('expect', ['-f', script], { encoding: 'utf8', timeout: (steps.length + 15) * (process.env.CI ? 8000 : 4000), killSignal: 'SIGKILL', maxBuffer: 5 * 1024 * 1024 });
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

test('type diagnostics appear while typing before Enter', async t => {
    const frames = await drive(t, [
        { keys: 'Count = 1' + ENTER, until: '1›' },
        { keys: 'Count = "wrong"', until: 'TypeError' },
        CLEAR + 'Count + 2'
    ], 40, 18);
    assert.match(frames[1].text, /TypeError/);
    assert.match(frames[1].text, /cannot receive text/);
    assert.doesNotMatch(frames[2].text, /TypeError|cannot receive/);
    assert.match(frames[2].text, /rank> Count \+ 2/);
});

test('function argument diagnostics appear before Enter and disappear after correction', async t => {
    const frames = await drive(t, [
        { keys: '\x1b[200~fun increment X\n Y = X + 1\n return Y\nend\x1b[201~' + ENTER, until: '<function increment>' },
        { keys: 'Input = "bad"' + ENTER, until: '2›' },
        { keys: 'Input increment', until: 'TypeError' },
        CLEAR + '3 increment'
    ], 60, 22);
    assert.match(frames[2].text, /TypeError: increment:/);
    assert.match(frames[2].text, /does not accept/);
    assert.doesNotMatch(frames[3].text, /TypeError|does not accept/);
    assert.match(frames[3].text, /rank> 3 increment/);
});

test('rank diagnostics appear for inline shaped arrays before Enter', async t => {
    const frames = await drive(t, [
        { keys: 'A = array 1 2 3' + ENTER, until: '1›' },
        { keys: 'A = array 1 2 3 4 shape 2 2', until: 'DimensionMismatch' },
        CLEAR + 'A = array 2 3 4 5'
    ], 80, 18);
    assert.match(frames[1].text, /DimensionMismatch/);
    assert.match(frames[1].text, /A has rank 1/);
    assert.match(frames[1].text, /cannot receive rank 2/);
    assert.doesNotMatch(frames[2].text, /DimensionMismatch|cannot receive/);
});

test('loop rank diagnostics appear before executing the pasted draft', async t => {
    const frames = await drive(t, [
        { keys: 'A = array 1 2' + ENTER, until: '1›' },
        { keys: '\x1b[200~for I in 1 to 3\n A = array shape 2 2 fill 0\nend\x1b[201~', until: 'DimensionMismatch' }
    ], 80, 22);
    assert.match(frames[1].text, /DimensionMismatch/);
    assert.match(frames[1].text, /A has rank 1/);
    assert.match(frames[1].text, /cannot receive rank 2/);
    assert.doesNotMatch(frames[1].text, /Runtime:/);
});

test('scalar diagnostics survive a known array write in an unexecuted draft', async t => {
    const frames = await drive(t, [
        '\x1b[200~fun change X\n X 0 = 1\n return 0\nend\nA = array 1 2\nCount = 3\nA change\nCount + "bad"\x1b[201~',
    ], 80, 28);
    assert.match(frames[0].text, /TypeError/);
    assert.match(frames[0].text, /operator \+ does not/);
    assert.match(frames[0].text, /integer and text/);
    assert.doesNotMatch(frames[0].text, /Runtime:/);
});

test('excess indices are diagnosed before Enter and an edited error disappears before Ctrl-R', async t => {
    const frames = await drive(t, ['A = array 2 2 2 2 shape 2 2' + ENTER,
        'A 0 0' + ENTER, 'A 0 0' + ENTER, 'A 0 0 0 0 0', ENTER,
        END + '\x7f'.repeat(6), '\x12'], 80, 18);
    assert.match(frames[3].text, /DimensionMismatch/);
    assert.match(frames[3].text, /5 selectors/);
    assert.match(frames[3].text, /exceed array rank 2/);
    assert.match(frames[4].text, /DimensionMismatch/);
    assert.doesNotMatch(frames[5].text, /DimensionMismatch|Runtime:|requires a sequence/);
    assert.match(frames[5].text, /A 0 0/);
    assert.doesNotMatch(frames[6].text, /DimensionMismatch|Runtime:/);
    assert.match(frames[6].text, /\n\s*2\n/);
});

test('Enter after end returns to rank prompt after previewing an unfinished function', async t => {
    const frames = await drive(t, [
        { keys: 'fun digit_sum N' + ENTER, until: 'Example digit_sum' },
        { keys: '"123456"' + ENTER, until: 'N = "123456"' },
        { keys: 'Digits = N text integer rank 0' + '\x12', until: 'Digits = N' },
        ENTER,
        { keys: 'return Digits sum' + ENTER, until: 'return Digits sum' },
        { keys: 'end' + ENTER, until: '<function digit_sum>' },
        { keys: '123456 digit_sum' + ENTER, until: '\\s+21' },
    ]);
    assert.match(frames[5].text.split('\n')[frames[5].cursorY], /^rank>\s*$/);
    assert.match(frames[6].text, /\n\s*21\n/);
    assert.match(frames[6].text.split('\n')[frames[6].cursorY], /^rank>\s*$/);
    assert.doesNotMatch(frames[6].text, /Example digit_sum/);
});

test('Enter after an unknown name edits the failed cell without duplicating it', async t => {
    const frames = await drive(t, ['sadsadafsdfddsds' + ENTER, ENTER, ENTER, ENTER], 40, 18);
    for (const frame of frames.slice(1)) {
        assert.match(frame.text, /1› sadsadafsdfddsds/);
        assert.doesNotMatch(frame.text, /2› sadsadafsdfddsds/);
    }
});

test('clearing an unknown name removes its error before removing the cell', async t => {
    const frames = await drive(t, [{ keys: 'Missing' + ENTER, until: 'Runtime' }, CLEAR], 40, 18);
    assert.match(frames[0].text, /Runtime: unknown name: Missing/);
    assert.match(frames[1].text, /rank> /);
    assert.doesNotMatch(frames[1].text, /Runtime: unknown name|unknown name: Missing/);
});

test('a function containing for returns to rank prompt after selecting an iteration', async t => {
    const frames = await drive(t, [
        'fun total N' + ENTER,
        '3' + ENTER,
        'Sum = 0' + ENTER,
        'for I in 1 to N' + '\x12',
        RIGHT,
        ENTER,
        ENTER,
        'Sum += I' + ENTER,
        'end' + ENTER,
        'return Sum' + ENTER,
        'end' + ENTER,
        '3 total' + ENTER,
    ], 80, 24);
    assert.match(frames[4].text, /I = 2 · iteration 2/);
    assert.doesNotMatch(frames[8].text, /<function total>/);
    assert.match(frames[10].text.split('\n')[frames[10].cursorY], /^rank>\s*$/);
    assert.match(frames[11].text, /\n\s*6\n/);
    assert.match(frames[11].text.split('\n')[frames[11].cursorY], /^rank>\s*$/);
});

test('Shift selection and mouse dragging replace source without executing pasted code', async t => {
    const frames = await drive(t, [
        'abcdef',
        '\x1b[1;2D\x1b[1;2D\x1b[1;2D',
        'XYZ',
        '\x1b[<0;7;1M\x1b[<32;10;1M\x1b[<0;10;1m',
        '\x1b[200~123\n456\x1b[201~',
        '\x1a',
    ]);
    assert.match(frames[1].raw, /\x1b\[7m/);
    assert.match(frames[2].text, /rank> abcXYZ/);
    assert.match(frames[3].raw, /\x1b\[7m/);
    assert.match(frames[4].text, /rank> 123\n\s*· 456XYZ/);
    assert.match(frames[5].text, /rank> abcXYZ/);
});

test('Ctrl-H toggles source-only copying and restores the editor cursor', async t => {
    const frames = await drive(t, [
        { keys: 'A = 1' + ENTER, until: '1›' },
        { keys: 'A + 2' + ENTER, until: '\\s+3' },
        { keys: 'Draft = "ab"' + '\x1b[D', until: 'Draft' },
        '\x08',
        'ignored\x1b[200~paste\x1b[201~',
        { keys: '\x08', until: 'Draft = "ab"' },
        '\x7f',
        '\x08',
        '\x1b',
    ]);
    assert.equal(frames[3].text.trimEnd(), 'A = 1\nA + 2\nDraft = "ab"');
    assert.equal(frames[4].text, frames[3].text);
    assert.equal(frames[5].text, frames[2].text);
    assert.equal(frames[5].cursorX, frames[2].cursorX);
    assert.equal(frames[5].cursorY, frames[2].cursorY);
    assert.match(frames[6].text, /Draft = "a"/);
    assert.equal(frames[8].text, frames[6].text);
});

test('copy view hides live function example fields and preserves their focus', async t => {
    const frames = await drive(t, [
        'fun hand_score Cards' + ENTER,
        '"example"' + '\x1b[D',
        '\x08',
        '\x08',
        ENTER,
        'Cards' + ENTER,
    ]);
    assert.equal(frames[2].text.trimEnd(), 'fun hand_score Cards');
    assert.equal(frames[3].text, frames[1].text);
    assert.equal(frames[3].cursorX, frames[1].cursorX);
    assert.equal(frames[3].cursorY, frames[1].cursorY);
});

test('real keyboard edits an old instruction, stops at its error, then resumes without losing new input', async t => {
    const frames = await drive(t, [
        'A = 1' + ENTER,
        { keys: 'B = A + 1' + ENTER, until: 'B =' },
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
    assert.match(frames[1].text, /●  1› A = 1/);
    assert.match(frames[1].text, /●  2› B = A \+ 2/);
    assert.equal((frames[2].text.match(/Tab:/g) ?? []).length, 1);
    assert.equal((frames[3].text.match(/Tab:/g) ?? []).length, 1);
    assert.doesNotMatch(frames[4].text, /Tab:/);
});

test('help opens outside the document and Esc removes it before returning to editing', async t => {
    const frames = await drive(t, [
        { keys: 'A = 1' + ENTER, until: '1›' },
        { keys: 'help' + ENTER, until: 'Editing' },
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

test('the next-eval marker remains in the branch body while the iterator is selected', async t => {
    const source = 'for i in 1 to 100\n  (array i)\n  if i less 4\n    (array i i)\n  else\n    (array i i i)\n  end\nend';
    const frames = await drive(t, [
        { keys: '\x1b[200~' + source + '\x1b[201~' + ENTER, until: '100 100 100' },
        UP + UP + UP + END,
        { keys: '\x12', until: 'Enter newline' },
        { keys: '\x07', until: '←/→ select' },
        { keys: RIGHT.repeat(8), until: 'i = 9 · iteration 9' },
        '\x12',
        { keys: '\x1b', until: '(\\^L|Ctrl-L) run all' },
    ], 40, 18);
    assert.match(frames[1].text.split('\n')[frames[1].cursorY], /\(array i i i\)/);
    assert.match(frames[2].text, /▶\s+\(array i i i\)/);
    assert.match(frames[3].text, /←\/→ select/);
    assert.match(frames[4].text, /i = 9 · iteration 9/);
    assert.match(frames[4].text, /else\n\s+branch runs/);
    assert.match(frames[4].text, /▶\s+\(array i i i\)/);
    assert.doesNotMatch(frames[4].text, /9 9 9/);
    assert.match(frames[5].text, /9 9 9/);
    assert.match(frames[5].text, /▶\s+end/);
    assert.doesNotMatch(frames[6].text, /▶/);
});

test('leaving an unused top insertion row restores the original numbering', async t => {
    const frames = await drive(t, [
        { keys: '1 + 1' + ENTER, until: '1›' },
        { keys: UP + UP, until: '2›' },
        DOWN,
        UP,
        '\x1b',
    ], 40, 12);
    assert.match(frames[1].text, /2› 1 \+ 1/);
    assert.match(frames[2].text, /1› 1 \+ 1/);
    assert.equal(frames[2].cursorY, 0);
    assert.match(frames[4].text, /1› 1 \+ 1/);
    assert.doesNotMatch(frames[4].text, /2›/);
});

test('Ctrl-R on an expression stops before the loop; returning from rank> edits instead of evaluating', async t => {
    const frames = await drive(t, [
        'use sequences' + ENTER,
        '1 + 1' + ENTER,
        '\x1b[200~for i in 10 to 100\n  (array i)\nend\x1b[201~' + ENTER,
        UP + UP + UP + UP,
        '\x12',
        '\x12',
        '\x12',
        { keys: '\x1b', until: 'Ctrl-R run|Ctrl-L run all' },
        '\x1b',
        UP,
        ENTER,
    ], 40, 16);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /for i in 10 to 100/);
    assert.match(frames[4].text, /Enter newline · \^R step/);
    assert.match(frames[5].text, /i = 10 · iteration 1/);
    assert.match(frames[6].text, /\(array i\)\n\s+10/);
    assert.match(frames[8].text.split('\n')[frames[8].cursorY], /^rank> /);
    assert.doesNotMatch(frames[9].text, /iteration 1/);
    assert.match(frames[9].text, /Ctrl-R run · Ctrl-L run all/);
    assert.doesNotMatch(frames[10].text, /iteration 1/);
});

test('completed loop headers reopen with Ctrl-R and Ctrl-G, then Esc restores editing', async t => {
    const frames = await drive(t, [
        'use sequences' + ENTER,
        '\x1b[200~for i in 10 to 100\n  (array i) len\nend\x1b[201~' + ENTER,
        UP + UP + UP,
        '\x12',
        RIGHT,
        { keys: '\x1b', until: 'Ctrl-R run' },
        '\x07',
        RIGHT,
        { keys: '\x1b', until: 'Ctrl-R run' },
        '\x12',
        '\x12',
    ], 40, 14);
    assert.match(frames[2].text.split('\n')[frames[2].cursorY], /for i in 10 to 100/);
    assert.match(frames[3].text.split('\n')[frames[3].cursorY], /i = 10 · iteration 1/);
    assert.match(frames[3].text, /←\/→ select · Esc edit/);
    assert.match(frames[4].text, /i = 11 · iteration 2/);
    assert.match(frames[5].text, /Ctrl-R run · Ctrl-L run all/);
    assert.match(frames[6].text, /i = 10 · iteration 1/);
    assert.match(frames[7].text, /i = 11 · iteration 2/);
    assert.match(frames[8].text, /Ctrl-R run · Ctrl-L run all/);
    assert.match(frames[8].text.split('\n')[frames[8].cursorY], /for i in 10 to 100/);
    assert.match(frames[9].text, /i = 10 · iteration 1/);
    assert.match(frames[10].text, /\(array i\) len\n\s+1/);
});

test('iteration selection needs Enter or Ctrl-G on a 40-column terminal', async t => {
    const frames = await drive(t, [
        'for I in 1 to 3' + ENTER,
        { keys: UP, until: 'Enter select' },
        { keys: RIGHT, until: 'iteration 1' },
        { keys: ENTER + RIGHT, until: 'iteration 2' },
        { keys: '\x1b', until: '\\^L run all' },
        { keys: '\x07' + RIGHT, until: 'iteration 3' },
        { keys: '\x1b', until: '\\^L run all' },
    ], 40, 12);
    assert.match(frames[1].text, /Enter select · Esc edit · \^L run all/);
    assert.match(frames[2].text, /I = 1 · iteration 1/);
    assert.match(frames[3].text, /I = 2 · iteration 2/);
    assert.match(frames[3].text, /Esc edit · \^L run all/);
    assert.equal(frames[4].cursorY, frames[0].cursorY);
    assert.match(frames[5].text, /I = 3 · iteration 3/);
    assert.equal(frames[6].cursorY, frames[0].cursorY);
});

test('Ctrl-R reruns an edit and the footer advertises a full restart', async t => {
    const frames = await drive(t, [
        'A = 1' + ENTER,
        UP + CLEAR + 'A = 5',
        '\x12',
    ]);
    assert.match(frames[0].text, /Ctrl-L run all/);
    assert.match(frames[1].text, /Ctrl-R run · Ctrl-L run all/);
    assert.match(frames[2].text, /\n      5\n/);
    assert.match(frames[2].text.split('\n')[frames[2].cursorY], /^rank> /);
    assert.doesNotMatch(frames[2].text, /F5/);
});

test('an error at the bottom keeps its compact diagnostic and source cursor in view', async t => {
    const frames = await drive(t, [
        ...Array.from({ length: 8 }, (_, i) => `A = ${i}` + ENTER),
        'Missing' + ENTER,
    ], 70, 12);
    const frame = frames.at(-1);
    assert.match(frame.text, /unknown name/);
    assert.match(frame.text, /Runtime: unknown name: Missing\nrank> /);
    assert.match(frame.text.split('\n')[frame.cursorY], /› Missing$/);
    assert.equal(frame.cursorX, 13);
});

test('Ctrl-Q offers saving and Esc restores the unsubmitted draft and cursor', async t => {
    const frames = await drive(t, [
        { keys: 'A = 1' + ENTER, until: '1›' },
        { keys: 'B = 2', until: 'B = 2' },
        { keys: '\x11', until: 'Save changes before exit' },
        { keys: '\x1b', until: 'rank> B = 2' },
    ]);
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
        { keys: 'A = 1' + ENTER, until: '1›' },
        { keys: '\x13', until: 'Save program' },
        { keys: target + ENTER, until: '· saved' },
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
    const saved = await drive(t, [
        { keys: 'A = 7' + ENTER, until: '1›' },
        { keys: 'exit' + ENTER, until: 'Save changes before exit' },
        's',
        target + ENTER
    ]);
    assert.match(saved[1].text, /Save changes before exit/);
    assert.match(saved[2].text, /Save before exit/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'A = 7\n');
    const discarded = await drive(t, [
        { keys: 'A = 8' + ENTER, until: '1›' },
        { keys: 'quit' + ENTER, until: 'Save changes before exit' },
        'd'
    ]);
    assert.match(discarded[1].text, /Save changes before exit/);
});

test('saving before exit uses the loaded file without asking for its name again', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-bound-exit-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const target = path.join(directory, 'loaded.ra');
    fs.writeFileSync(target, 'A = 1\n');
    const frames = await drive(t, [
        { keys: `load ${target}` + ENTER, until: 'loaded.ra · saved' },
        { keys: UP + CLEAR + 'A = 2', until: 'A = 2' },
        { keys: '\x11', until: 'Save changes before exit' },
        's',
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
        { keys: `load ${target}` + ENTER, until: 'A = Missing' },
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
    const frames = await drive(t, [
        { keys: 'X = 1' + ENTER, until: '1›' },
        { keys: UP + CLEAR + 'X = array 1 2 3', until: 'X = array 1 2 3' },
        { keys: DOWN + ENTER, until: '1 2 3' }
    ]);
    assert.match(frames[2].text, /X = array 1 2 3\n      1 2 3\nrank> /);
    assert.doesNotMatch(frames[2].text, /cannot receive/);
});


const SLOW_LOOP = '\x1b[200~T = 0\nfor I in 1 to 1000000\n  T = T + (I text len)\nend\x1b[201~' + ENTER;

test('keys typed while a cell runs are kept and run at the next prompt', async t => {
    const frames = await drive(t, [
        // Type as soon as the loop runs, so a short loop is still running.
        { keys: SLOW_LOOP, until: 'Running', early: true },
        { keys: 'B = 21 * 2' + ENTER, until: '\\s42' },
    ], 60, 18);
    assert.match(frames[0].text, /Running/);
    assert.match(frames[1].text, /3› B = 21 \* 2\n\s+42\n/);
    assert.match(frames[1].text.split('\n')[frames[1].cursorY], /^rank>\s*$/);
});

test('Ctrl-C drops the keys typed ahead of the stopped cell', async t => {
    const frames = await drive(t, [
        { keys: 'use numbers' + ENTER, until: '1›' },
        running('170141183460469231731687303715884105727 factors' + ENTER),
        running('B = 1' + ENTER),
        '\x03',
    ], 60, 18);
    assert.match(frames[3].text, /Stopped after/);
    assert.match(frames[3].text.split('\n')[frames[3].cursorY], /^rank>\s*$/);
    assert.doesNotMatch(frames[3].text, /B = 1/);
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
        { keys: 'use tables' + ENTER, until: 'tables' },
        { keys: `Db = ${JSON.stringify(filename)} sqlite` + ENTER, until: 'sqlite' },
        '',
        running(`Db ${JSON.stringify(sql)} (array shape 0 fill 0) sqlquery array` + ENTER),
        running(UP),
        '\x03',
        'Rows = Db "SELECT 42 AS answer" (array shape 0 fill 0) sqlquery array' + ENTER,
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
        { keys: 'use numbers' + ENTER, until: 'use numbers' },
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

test('bracketed paste uses the cursor in the focused function argument', async t => {
    const frames = await drive(t, [
        'fun hand_score Cards' + ENTER,
        '""\x1b[D',
        '\x1b[200~5H 5C 6S 7S KD\x1b[201~',
        ENTER,
        'Cards' + ENTER,
    ], 100, 30);
    assert.match(frames[1].text, /Cards = ""/);
    assert.match(frames[2].text, /rank> fun hand_score Cards\n\s+Cards = "5H 5C 6S 7S KD"/);
    assert.equal(frames[2].cursorX, '      Cards = "5H 5C 6S 7S KD'.length);
    assert.match(frames[4].text, /\n        5H 5C 6S 7S KD\n/);
});

test('an open function evaluates body lines immediately on example arguments', async t => {
    const frames = await drive(t, [
        { keys: 'fun inc N' + ENTER, until: 'Example inc' },
        { keys: '2' + ENTER, until: 'N = 2' },
        { keys: 'A = N + 1' + ENTER, until: '\\s+3' },
        { keys: 'A * 2' + ENTER, until: '\\s+6' },
        { keys: 'end' + ENTER, until: '<function inc>' },
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

test('up from the first body line reopens Cards for an array example', async t => {
    const frames = await drive(t, [
        'fun hand_score Cards' + ENTER,
        '"5H 5C"' + ENTER,
        'return Cards',
        UP,
        CLEAR + 'array "5H" "5C"' + ENTER,
        ENTER,
        'end' + ENTER,
    ]);
    assert.match(frames[3].text.split('\n')[frames[3].cursorY], /^\s+Cards = "5H 5C"/);
    assert.match(frames[4].text, /Cards = array "5H" "5C"/);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /return Cards/);
    assert.match(frames[5].text, /return Cards\n\s+5H 5C/);
    assert.doesNotMatch(frames[5].text, /Runtime:|cannot receive/);
    assert.match(frames[6].text, /<function hand_score>/);
});

test('mouse clicks place the cursor in argument values and source', async t => {
    const frames = await drive(t, [
        'fun hand_score Cards' + ENTER,
        '"ab"' + ENTER,
        'return Cards',
        '\x1b[<0;17;2M\x1b[<0;17;2m' + 'X',
        '\x1b[<0;21;3M\x1b[<0;21;3m' + ' ',
    ]);
    assert.match(frames[3].text, /Cards = "aXb"/);
    assert.equal(frames[3].cursorY, 1);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /return Cards/);
    assert.equal(frames[4].cursorY, 2);
    assert.match(frames[4].text, /Cards = "aXb"/);
    assert.doesNotMatch(frames[4].text, /<0;/);
});

test('arrows leave example fields in both directions without losing edits or evaluating', async t => {
    const frames = await drive(t, [
        'fun hand_score Cards' + ENTER,
        'array "5H" "5C"' + ENTER,
        'Values = Cards',
        UP,
        UP,
        DOWN,
        CLEAR + 'array "KD"' + DOWN,
        UP,
        DOWN,
    ]);
    assert.match(frames[3].text.split('\n')[frames[3].cursorY], /Cards = array/);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /fun hand_score Cards/);
    assert.match(frames[5].text.split('\n')[frames[5].cursorY], /Cards = array/);
    assert.match(frames[6].text.split('\n')[frames[6].cursorY], /Values = Cards/, frames[6].text);
    assert.match(frames[7].text.split('\n')[frames[7].cursorY], /Cards = array "KD"/);
    assert.match(frames[8].text.split('\n')[frames[8].cursorY], /Values = Cards/);
    assert.doesNotMatch(frames[8].text, /\n\s+KD\n|→ array\[2\]/);
});

test('function examples show split values and ranked failures show the failing card', async t => {
    const frames = await drive(t, [
        { keys: '\x1b[200~use sequences\nuse text\nRanks = "23456789TJQKA"\nfun card_value Card\n  Rank = Card 0\n  return Ranks Rank find\nend\x1b[201~' + ENTER, until: '<function card_value>' },
        'fun hand_score Cards' + ENTER,
        '"5H 5C" "" split' + ENTER,
        'Values = Cards card_value rank 0' + ENTER,
        UP,
        CLEAR + '"5H 5C" " " split' + ENTER,
        ENTER,
    ], 60, 24);
    assert.match(frames[2].text, /→ array\[5\]: "5" "H" " " "5" "C"/);
    assert.match(frames[3].text, /card_value\n[^\n]*Card = "H"/);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /Cards = /);
    assert.match(frames[5].text, /→ array\[2\]: "5H" "5C"/);
    assert.doesNotMatch(frames[6].text, /Missing:|Card = "H"/);
    assert.match(frames[6].text, /Values = Cards card_value rank 0\n\s+3 3/);
});

test('arrow keys edit visible function arguments and return to them from the body', async t => {
    const frames = await drive(t, [
        { keys: 'fun add X Y' + ENTER, until: 'X =' },
        { keys: '1' + DOWN, until: 'Y =' },
        { keys: '2' + UP, until: 'X = 1' },
        { keys: CLEAR + '3' + DOWN, until: 'X = 3' },
        ENTER,
        { keys: 'return X + Y' + ENTER, until: '\\s+5' },
        UP + UP,
        { keys: CLEAR + '4' + ENTER, until: 'Y = 4' },
        { keys: ENTER, until: '\\s+7' },
        { keys: 'end' + ENTER, until: '<function add>' },
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
        { keys: 'A = array 1 2 3' + ENTER, until: '1›' },
        { keys: 'fun plus X Y' + ENTER, until: 'X =' },
        { keys: 'A' + ENTER, until: 'Y =' },
        { keys: 'A+1' + ENTER, until: 'A\\+1' },
        { keys: 'return X + Y -1' + ENTER, until: '2 4 6' },
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
        { keys: 'A = 1' + ENTER, until: '1›' },
        { keys: 'fun inc X' + ENTER, until: 'Example inc' },
        { keys: 'A = 1' + ENTER, until: 'Syntax' },
        { keys: CLEAR + 'A' + ENTER, until: 'X = A' },
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
        { keys: CLEAR + 'array 0 1 2' + ENTER, until: 'Pick = array 0 1 2' },
    ], 100, 20);
    assert.match(frames[2].text, /Pick = 0 1 2\n\s+! Runtime: value application\s+requires a sequence and one\s+selector/);
    assert.match(frames[2].text.split('\n')[frames[2].cursorY], /Pick = 0 1 2/);
    assert.doesNotMatch(frames[2].text, /\(123123\) \(0 1 2\) family|<repl>:\d+:/);
    assert.match(frames[3].text, /Pick = array 0 1 2/);
    assert.doesNotMatch(frames[3].text, /! Runtime:/);
});

test('fixing func to fun turns the failed cell into live function input', async t => {
    const frames = await drive(t, [
        { keys: 'func inc2 Y' + ENTER, until: 'unknown name: func' },
        { keys: CLEAR + 'fun inc2 Y' + ENTER, until: 'Example inc2' },
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
        '',
        '\x12',
        { keys: 'return Result' + '\x12', until: 'return Result' },
        'end' + '\x12',
    ], 80, 20);
    assert.match(frames[3].text, /Result = N \+ 1/);
    assert.match(frames[3].text, /N = 4/);
    assert.doesNotMatch(frames[3].text, /Example inc/);
    assert.match(frames[3].text, /Result = N \+ 1\n        5/);
    assert.doesNotMatch(frames[3].text, /<function inc>|●\s*1›/);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /Result = N \+ 1/);
    assert.match(frames[4].text, /Result = N \+ 1\n        5/);
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
    assert.match(frames[3].text, /Enter try · \^T args · \^L run all/);
    assert.doesNotMatch(frames[3].text, /<function inc>|\n\s*end\s*\n/);
    assert.match(frames[3].text.split('\n')[frames[3].cursorY], /^\s*▶?\s*$/);
    assert.match(frames[4].text, /return X \+ 1\n        2\n    ●   \n    ▶   return X \+ 2/);
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
    assert.match(frame.text, /Syntax:/);
    assert.doesNotMatch(frame.text, /error: RankError/);
    assert.match(frame.text.split('\n')[frame.cursorY], /resutl = X \+ 2/);
    assert.doesNotMatch(frame.text, /<function inc>/);
});

test('postfix comparisons select whole arrays and column cells in the terminal', async t => {
    const frames = await drive(t, [
        { keys: 'A = array shape 2 2 fill 1' + ENTER, until: 'shape 2 2' },
        { keys: 'B = array shape 2 2 fill 1' + ENTER, until: 'shape 2 2' },
        { keys: 'B 0 1 = 9' + ENTER, until: '3›' },
        { keys: 'A B equal rank 2' + ENTER, until: 'false' },
        { keys: 'A B equal axis 1 rank 1' + ENTER, until: 'true false' },
    ], 80, 22);
    assert.match(frames[3].text, /false/);
    assert.match(frames[4].text, /true false/);
    assert.doesNotMatch(frames[4].text, /Syntax:|Runtime:/);
});

test('multiline assignment previews work in the terminal', async t => {
    const frames = await drive(t, [
        '\x1b[200~fun hand_score Cards\n  WheelMask = (\n    Cards equal (array 0 1 2 3 12)\n  )\nend\x1b[201~' + ENTER,
        UP,
        UP,
        '\x12',
        'array 3 3 4 5 11' + ENTER,
        '\x12',
    ], 80, 22);
    assert.match(frames[5].text, /false false false false false/);
    assert.doesNotMatch(frames[5].text, /Syntax:/);
});

test('Ctrl-R reopens a completed function at the selected line with its old example', async t => {
    const frames = await drive(t, [
        'fun inc X' + ENTER,
        '2' + ENTER,
        'Result = X + 1' + ENTER,
        'Result *= 2' + ENTER,
        'end' + ENTER,
        UP,
        UP,
        '\x12',
        '\x12',
        '\x12',
    ], 80, 22);
    assert.equal(frames[7].cursorY, frames[6].cursorY);
    assert.doesNotMatch(frames[7].text, /Example inc/);
    assert.match(frames[7].text.split('\n')[frames[7].cursorY], /Result \*= 2/);
    assert.match(frames[7].text, /Result \*= 2\n        6/);
    assert.doesNotMatch(frames[7].text, /<function inc>/);
    assert.match(frames[8].text, /Result = X \+ 1\n        3/);
    assert.match(frames[8].text, /Result \*= 2\n        6/);
    assert.match(frames[8].text.split('\n')[frames[8].cursorY], /end/);
    assert.match(frames[9].text, /<function inc>/);
});

test('loop arrows keep the cursor on the visible iteration and defer body evaluation', async t => {
    const frames = await drive(t, [
        'for i in 1 to 3' + ENTER,
        '\x07' + RIGHT,
        ENTER,
        { keys: 'A = i' + '\x12', until: 'A = i' },
        UP + UP,
        ENTER + RIGHT,
        ENTER,
        '\x12',
    ], 80, 18);
    assert.doesNotMatch(frames[0].text.split('\n')[frames[0].cursorY], /iteration/);
    assert.match(frames[1].text.split('\n')[frames[1].cursorY], /i = 2 · iteration 2/);
    assert.doesNotMatch(frames[1].text, /A = i/);
    assert.match(frames[2].text.split('\n')[frames[2].cursorY], /▶/);
    assert.match(frames[3].text, /A = i\n\s+2/);
    assert.match(frames[4].text.split('\n')[frames[4].cursorY], /i = 2 · iteration 2/);
    assert.match(frames[5].text.split('\n')[frames[5].cursorY], /i = 3 · iteration 3/);
    assert.doesNotMatch(frames[5].text, /A = i\n\s+2/);
    assert.match(frames[7].text, /A = i\n\s+3/);
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
    assert.match(frames[4].raw, /Running…/);
    assert.doesNotMatch(frames[4].raw, /rank> /, 'iteration must not flash the notebook');
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
    assert.match(frames[4].raw + frames[5].raw, /Running…/);
    assert.doesNotMatch(frames[4].raw + frames[5].raw, /rank> /);
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
    const frames = await drive(t, [
        { keys: `load ${target}` + ENTER, until: 'forward.ra' },
        { keys: 'twi\t', until: 'twice ' },
        { keys: CLEAR + ENTER, until: '42' }
    ]);
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
        { keys: `load ${target}` + ENTER, until: 'forward.ra' },
        { keys: ENTER, until: '<function twice>' },
        paused(UP + UP + UP + UP + UP + '\x14'),
        paused('\x14'),
        ENTER,
        '\x03',
    ], 100, 30);
    assert.match(frames[2].text, /Paused · before line 3/);
    assert.match(frames[2].text, /● 3 │ Answer = 21 twice/);
    assert.match(frames[2].text, /1 │ rem Example/);
    assert.match(frames[3].text, /Paused · before line 5/);
    assert.match(frames[3].text, /● 5 │ fun twice X/);
    assert.match(frames[3].text, /3 │ Answer = 21 twice/);
    assert.ok(frames[3].text.indexOf('Call stack') < frames[3].text.indexOf('● 5 │'));
    assert.ok(frames[3].text.indexOf('Variables (current scope)') > frames[3].text.indexOf('● 5 │'));
    assert.doesNotMatch(frames[3].text, /<repl>:/);
});

test('mouse wheel scrolls source without moving the editing cursor', async t => {
    const source = Array.from({ length: 35 }, (_, i) => `rem row${i}`).join('\n');
    const frames = await drive(t, [
        { keys: '\x1b[200~' + source + '\x1b[201~', until: 'row34' },
        '\x1b[<64;10;3M'.repeat(20),
        '\x1b[<65;10;3M',
        'X',
    ], 80, 12);
    assert.match(frames[0].text, /row34/);
    assert.match(frames[1].text, /row0\b/);
    assert.doesNotMatch(frames[2].text, /row0\b/);
    assert.match(frames[2].text, /row3\b/);
    assert.match(frames[3].text, /row34X/);
    assert.doesNotMatch(frames[3].text, /64;10|65;10/);
});

test('Esc leaves function evaluation so Enter inserts a line before end', async t => {
    const frames = await drive(t, [
        'fun inc X' + ENTER,
        '2' + ENTER,
        'Result = X + 1' + ENTER,
        'end' + ENTER,
        UP,
        UP,
        END,
        '\x12',
        '\x1b',
        ENTER,
        'Result *= 2',
        '\x12',
    ], 80, 22);
    assert.match(frames[7].text, /Enter newline · \^R run/);
    assert.match(frames[8].text.split('\n')[frames[8].cursorY], /Result = X \+ 1/);
    assert.match(frames[9].text.split('\n')[frames[9].cursorY], /^\s*[·●]?\s*$/);
    assert.match(frames[10].text, /Result \*= 2\n.*end/);
    assert.match(frames[11].text, /Result \*= 2\n        6/);
    assert.doesNotMatch(frames[11].text, /Example inc/);
});

test('Enter during evaluation inserts a temporary line that disappears when left empty', async t => {
    const frames = await drive(t, [
        'fun inc X' + ENTER,
        '2' + ENTER,
        'Result = X + 1' + ENTER,
        'end' + ENTER,
        UP, UP, END, '\x12',
        ENTER,
        DOWN,
        UP, END, ENTER,
        'Result *= 2',
        DOWN,
        UP,
        '\x12',
    ], 80, 22);
    assert.match(frames[8].text.split('\n')[frames[8].cursorY], /^\s*[·●▶]?\s*$/);
    assert.match(frames[9].text, /Result = X \+ 1\n[^\n]*end/);
    assert.match(frames[14].text, /Result \*= 2\n[^\n]*end/);
    assert.match(frames[16].text, /Result \*= 2\n        6/);
    assert.doesNotMatch(frames[16].text, /Example inc/);
});

test('Tab restores indentation on an empty function line before completion', async t => {
    const frames = await drive(t, [
        { keys: '\x1b[200~fun identity X\n  return X\n\nend\x1b[201~', until: 'end' },
        { keys: ENTER, until: '<function identity>' },
        UP,
        UP,
        '\x01',
        '\t',
        { keys: 'Value = 1', until: 'Value = 1' },
    ], 80, 18);
    assert.equal(frames[4].cursorX, 6);
    assert.equal(frames[5].cursorX, 8);
    assert.equal(frames[5].cursorY, frames[4].cursorY);
    assert.doesNotMatch(frames[5].text, /No completions/);
    assert.match(frames[6].text, /  Value = 1/);
});
