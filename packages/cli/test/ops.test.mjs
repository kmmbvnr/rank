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
    const session = repl(['ops ranges']);
    assert.match(session.stdout, /Low to High/);
    assert.match(session.stdout, /Low until High/);

    const bits = repl(['ops bits']);
    assert.match(bits.stdout, /Value Count shl/);
});

test('ops refuses a name that is neither module nor operation', () => {
    const session = repl(['ops nosuchthing']);
    assert.match(session.stderr + session.stdout, /unknown module or name: nosuchthing/);
});
