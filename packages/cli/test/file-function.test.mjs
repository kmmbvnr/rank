import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

function program(t, name, source) {
    const directory = mkdtempSync(join(tmpdir(), 'rank-file-function-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, name);
    writeFileSync(file, source);
    return file;
}

const multiples = `use numbers
use cli
arg Limit integer = 1000
N = 1 till Limit
Mask' = N mod 3 equal 0
Mask' or= N mod 5 equal 0
return N Mask sum
`;

test('the host prints the value a file returns', t => {
    const file = program(t, 'multiples.ra', multiples);
    assert.equal(run([file]).stdout, '233168\n');
    assert.equal(run([file, '10']).stdout, '23\n');
    assert.equal(run([file, '--limit', '5']).stdout, '3\n');
});

test('a file with its own print and a return shows both', t => {
    const file = program(t, 'both.ra', 'use io\n"first" print\nreturn 7\n');
    assert.equal(run([file]).stdout, 'first\n7\n');
});

test('a file without a return prints only what it prints', t => {
    const file = program(t, 'plain.ra', 'use io\n"only" print\n3 + 4\n');
    assert.equal(run([file]).stdout, 'only\n');
});

test('an argument of the wrong type is reported', t => {
    const file = program(t, 'multiples.ra', multiples);
    const result = run([file, '--limit', '1.5']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected integer input, got: 1.5/);
});

test('a returned deferred value is completed and fused into one pass', t => {
    const file = program(t, 'multiples.ra', multiples);
    const result = run(['--diagnostics=all', file]);
    assert.equal(result.stdout, '233168\n');
    assert.doesNotMatch(result.stderr, /native-array-map/);
});
