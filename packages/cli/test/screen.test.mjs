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
function transcript(lines) {
    const steps = lines.flatMap(line => [
        ...(line === '' ? [] : [`send ${JSON.stringify(line)}`, 'sleep 0.2']),
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
