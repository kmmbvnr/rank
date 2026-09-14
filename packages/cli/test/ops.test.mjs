import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

function repl(lines) {
    return spawnSync(process.execPath, [cli], {
        encoding: 'utf8',
        input: lines.join('\n') + '\nexit\n',
    });
}

test('ops describes one name from the catalogue', () => {
    const session = repl(['use numbers', 'ops divisors']);
    assert.equal(session.status, 0);
    assert.match(session.stdout, /N divisors/);
    assert.match(session.stdout, /positive divisors/);
    // The facts line carries module, arity, result and laziness.
    assert.match(session.stdout, /numbers, 1 operand, sequence, lazy/);
});

test('ops names the use a name still needs', () => {
    const session = repl(['ops shuffle']);
    assert.match(session.stdout, /needs: use random/);
    assert.match(session.stdout, /1 or 2 operands, array, random/);
});

test('ops lists a module as forms, bare syntax included', () => {
    const session = repl(['ops core']);
    assert.match(session.stdout, /Low to High/);
    assert.match(session.stdout, /Low until High/);

    const bits = repl(['ops bits']);
    assert.match(bits.stdout, /Value Count shl/);
});

test('ops refuses a name that is neither module nor operation', () => {
    const session = repl(['ops nosuchthing']);
    assert.match(session.stderr + session.stdout, /unknown module or name: nosuchthing/);
});

test('ops describes core names as already available', () => {
    const session = repl(['ops len', 'ops sum', 'ops min', 'ops max', '1 to 5 sum']);
    assert.equal(session.status, 0, session.stderr);
    assert.doesNotMatch(session.stdout, /needs: use/);
    assert.match(session.stdout, /core, 1 operand/);
    assert.match(session.stdout, /15/);
});

test('CLI declarations require use cli in a REPL workspace', () => {
    const session = repl(['option N integer = 3', 'use cli', 'option N integer = 3', 'N']);
    assert.match(session.stderr + session.stdout, /option requires: use cli/);
    assert.match(session.stdout, /3/);
});

test('numeric and text conversions are visible without imports', () => {
    const session = repl(['ops integer', 'ops real', 'ops text', 'X = 1', 'Y = 2.7', 'X = Y integer', 'Y = X real']);
    assert.equal(session.status, 0, session.stderr);
    assert.doesNotMatch(session.stdout, /needs: use/);
    assert.doesNotMatch(session.stderr, /RankError/);
    assert.match(session.stdout, /Value real/);
});
