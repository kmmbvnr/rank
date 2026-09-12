import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { eraseRows, screenRows } from '../out/screen.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

test('a line takes as many rows as the terminal is wide', () => {
    assert.equal(screenRows(0, 80), 1);
    assert.equal(screenRows(40, 80), 1);
    // A line that fills the row exactly has not wrapped yet.
    assert.equal(screenRows(80, 80), 1);
    assert.equal(screenRows(81, 80), 2);
    assert.equal(screenRows(160, 80), 2);
    // An unknown width is not a reason to claim a line is taller than it is.
    assert.equal(screenRows(40, 0), 1);
});

test('rows out of reach are left alone rather than erased', () => {
    const written = [];
    const screen = { rows: 10, write: chunk => written.push(chunk) };
    assert.equal(eraseRows(screen, 0), true);
    assert.equal(written.length, 0);
    assert.equal(eraseRows(screen, 3), true);
    assert.equal(written.join(''), '\x1b[3A\x1b[1G\x1b[0J');
    // Taller than the screen: the rows above have scrolled away and belong to
    // whatever is there now.
    written.length = 0;
    assert.equal(eraseRows(screen, 10), false);
    assert.equal(written.length, 0);
});

/**
 * Drives the real prompt through a pty. What matters is the escape stream: a
 * line that ran is printed again with no prompt in front of it, which is what
 * makes the screen read as the file the session is writing.
 */
const KEYS = { '<TAB>': '\\t', '<UP>': '\\033\\[A', '<DOWN>': '\\033\\[B', '<BS>': '\\177' };

function transcript(lines) {
    const steps = lines.flatMap(line => [
        // Readline reads a key arriving inside a burst as plain text, so each
        // one is sent on its own; a listing needs the second of two tabs.
        ...line.split(/(<[A-Z]+>)/).filter(piece => piece !== '').flatMap(piece =>
            KEYS[piece] === undefined
                ? [`send ${JSON.stringify(piece)}`, 'sleep 0.2']
                : [`send "${KEYS[piece]}"`, 'sleep 0.3']),
        'send "\\r"',
        'sleep 0.3',
    ]);
    const file = path.join(os.tmpdir(), `rank-screen-${process.pid}.exp`);
    fs.writeFileSync(file, [
        'set timeout 10',
        `spawn ${process.execPath} ${cli}`,
        'expect "rank> "',
        ...steps,
        'send "exit\\r"',
        'expect eof',
    ].join('\n'));
    try {
        return spawnSync('expect', ['-f', file], { encoding: 'utf8' }).stdout ?? '';
    } finally {
        fs.rmSync(file, { force: true });
    }
}

test('a completion listing goes with the prompt that asked for it', () => {
    // `use ` offers every module, which is more than one row of names.
    const session = transcript(['use <TAB><TAB>numbers']);
    const erased = /\x1b\[(\d+)A\x1b\[1G\x1b\[0Juse numbers\r\n/.exec(session);
    assert.ok(erased, 'the accepted line was never printed back');
    // The prompt is one row; anything above it is the listing being taken back.
    assert.ok(Number(erased[1]) > 3, `only ${erased[1]} rows erased`);
});

test('a second listing replaces the first rather than piling on it', () => {
    // Three tabs print two listings, so the newer one has to take the older
    // one back before it is drawn; the last erase is the one Enter does.
    const session = transcript(['use <TAB><TAB><TAB>numbers']);
    const erased = [...session.matchAll(/\x1b\[(\d+)A/g)].map(found => Number(found[1]));
    const listings = erased.filter(rows => rows > 3);
    assert.equal(listings.length, 2, `erased ${JSON.stringify(erased)}`);
});

test('the arrows step back into the file and Enter walks forward again', () => {
    // Up twice reaches the first statement, which is then fixed; the Enter
    // that ends the line runs it, and the next Enter runs the line below with
    // the value the fix gave it.
    const session = transcript(['A, 3', 'B, A * 2', '<UP><UP><BS>5', '', 'list']);
    assert.match(session, / {3}1> /, 'the prompt never named the line');
    assert.match(session, /\x1b\[0JA = 5\r\n/);
    assert.match(session, /\x1b\[2m10/, 'B was not worked out again');
    // The file is the two lines it always was: the fix replaced one. `list`
    // dims the number, so the escape that ends it sits inside the line.
    assert.match(session, /\x1b\[2m {2}1 \x1b\[22m A = 5/);
    assert.match(session, /\x1b\[2m {2}2 \x1b\[22m B = A \* 2/);
    assert.doesNotMatch(session, /\x1b\[2m {2}3 /);
});

test('a blank line between statements is part of the file', () => {
    const file = path.join(os.tmpdir(), `rank-blank-${process.pid}.ra`);
    const source = ['A = 1', '', 'B = 2', `save ${file}`, 'exit'].join('\n') + '\n';
    const result = spawnSync(process.execPath, [cli], { input: source, encoding: 'utf8' });
    assert.equal(result.status, 0);
    try {
        // Spacing is the one thing a file has that no statement can say.
        assert.equal(fs.readFileSync(file, 'utf8'), 'A = 1\n\nB = 2\n');
    } finally {
        fs.rmSync(file, { force: true });
    }
});

test('an accepted line is printed back as source, without its prompt', () => {
    const session = transcript(['A, 3', 'fun triple X', 'return X * 3', '', 'vars']);
    // The comma key became `=` and the line stands on its own.
    assert.match(session, /\x1b\[0JA = 3\r\n/);
    // The blank line supplied the `end`, so the block reads as a written one.
    assert.match(session, /\x1b\[0Jfun triple X\r\n/);
    assert.match(session, /\x1b\[0J {2}return X \* 3\r\n/);
    assert.match(session, /\x1b\[0Jend\r\n/);
    // A result is dim: what the run produced, next to the program.
    assert.match(session, /\x1b\[2m3/);
    // A command is not a line of the program, so it is dim too.
    assert.match(session, /\x1b\[2mvars/);
});
