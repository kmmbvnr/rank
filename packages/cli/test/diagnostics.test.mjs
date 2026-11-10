import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
function fixture(t, count, fail = false) {
    const directory = mkdtempSync(join(tmpdir(), 'rank-loop-diagnostics-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, 'program.ra');
    writeFileSync(file, `use io
use cli
arg Count integer = 3
T = 0
for R in 1 to Count
${Array.from({ length: count - 1 }, () => '  A = 0').join('\n')}
  T += ${fail ? '1 // 0' : 'R'}
end
T print
`);
    return file;
}
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('Euler 001 explains completed paths before listing rejected candidates', () => {
    const file = fileURLToPath(new URL('../../../demos/euler/001_multiples.ra', import.meta.url));
    const result = run(['--diagnostics=all', file]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '233168\n');
    const summary = result.stderr.split('Execution counters')[0];
    assert.ok(summary.includes(`${file}:12:1 native`), summary);
    assert.ok(summary.includes(`${file}:14:1 compiled`), summary);
    assert.ok(summary.includes(`${file}:15:1 mixed (compiled + native)`), summary);
    assert.ok(summary.includes(`${file}:17:1 compiled`), summary);
    assert.ok(summary.includes(`${file}:18:1 native`), summary);
    assert.match(summary, /mod: expected two integer scalars and a nonzero right operand/);
    assert.match(summary, /non-scalar object \(not inspected\)/);
    assert.match(summary, /delegated to native-array-map, native-operator/);
    assert.match(summary, /rejected candidates: scalar-expression, tensor/);
});

test('diagnostics explains the region budget and preserves program arguments and stdout', t => {
    const file = fixture(t, 129);
    const normal = run([file, '--count', '4']);
    assert.equal(normal.status, 0, normal.stderr);
    assert.equal(normal.stdout, '10\n');
    assert.equal(normal.stderr, '');
    const diagnostic = run(['--diagnostics', file, '--count', '4']);
    assert.equal(diagnostic.status, 0, diagnostic.stderr);
    assert.equal(diagnostic.stdout, normal.stdout);
    assert.match(diagnostic.stderr, /compiledLoops: 0/);
    assert.match(diagnostic.stderr, /loop:statement-budget:AssignmentStatement: 1/);
});

test('diagnostics reports successful compilation above 32 statements', t => {
    const result = run(['--diagnostics', fixture(t, 40)]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '6\n');
    assert.match(result.stderr, /compiledLoops: 1/);
    assert.doesNotMatch(result.stderr, /(?:^|\s)loop:statement-budget/);
});

test('diagnostics remains available after a runtime error', t => {
    const result = run(['--diagnostics', fixture(t, 129, true)]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /loop:statement-budget:AssignmentStatement/);
    assert.match(result.stderr, /RankError/);
});

test('diagnostics requires a file and appears in help', () => {
    const missing = run(['--diagnostics']);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /--diagnostics needs a file/);
    const help = run(['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--diagnostics <file>/);
});

test('diagnostics distinguishes a rejected Number candidate from exact execution', t => {
    const directory = mkdtempSync(join(tmpdir(), 'rank-function-diagnostics-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, 'program.ra');
    writeFileSync(file, 'use io\nfun X square\n return X * X\nend\n100000000 square print');
    const normal = run([file]);
    const result = run(['--diagnostics=all', file]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, normal.stdout);
    assert.equal(result.stdout, '10000000000000000\n');
    assert.match(result.stderr, /scalar-function-number execute: declined/);
    assert.match(result.stderr, /scalar-function-number:integer-exactness-guard/);
    assert.match(result.stderr, /scalar-function-direct execute: selected/);
    assert.match(result.stderr, /proven types: .*"X":"integer"/);
    assert.ok(result.stderr.includes(`${file}:2:1`), result.stderr);
});


test('diagnostics identifies the selected loop path for gather/update work', t => {
    const directory = mkdtempSync(join(tmpdir(), 'rank-array-diagnostics-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, 'program.ra');
    writeFileSync(file, `use io
use sequences
A = array 1 2 3 4
for P in 1 to 2
 Ix = 0 to 3
 V = A Ix
 W = V + P
 A Ix = W mod 100
end
A sum print
`);
    const result = run(['--diagnostics', file]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '22\n');
    // The Number loop now owns this work rather than the standalone fused region.
    assert.match(result.stderr, /numberLoops: 1/);
    assert.match(result.stderr, /fusedArrayRegions: 0/);
    assert.match(result.stderr, /fusedArrayRegionCells: 0/);
});

test('diagnostics locates the rejected statement and explains its budget', t => {
    const file = fixture(t, 129);
    const result = run(['--diagnostics=all', file]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stderr.includes(`${file}:134:3`), result.stderr);
    assert.match(result.stderr, /The region exceeds the statement budget/);
    assert.match(result.stderr, /source: "T \+= R"/);
    assert.match(result.stderr, /another compiled or native path/);
});

test('diagnostics reports non-loop sites and makes truncation recoverable', t => {
    const directory = mkdtempSync(join(tmpdir(), 'rank-all-diagnostics-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const file = join(directory, 'program.ra');
    writeFileSync(file, 'use io\n' + Array.from({ length: 80 }, (_, i) => `Value${i} = array 1 2 3`).join('\n') + '\nValue79 sum print\n');
    const normal = run([file]);
    const limited = run(['--diagnostics', file]);
    const complete = run(['--diagnostics=all', file]);
    for (const result of [normal, limited, complete]) {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, '6\n');
    }
    assert.equal(normal.stderr, '');
    assert.match(limited.stderr, /rejection occurrences omitted/);
    assert.match(limited.stderr, /--diagnostics=all/);
    assert.doesNotMatch(complete.stderr, /rejection occurrences omitted/);
    assert.ok(complete.stderr.includes(`${file}:81:`), complete.stderr);
    assert.match(complete.stderr, /tensor:unsupported-type:array/);
});
