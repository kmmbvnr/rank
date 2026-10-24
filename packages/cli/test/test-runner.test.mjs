import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

function runTest(target) {
    return spawnSync(process.execPath, [cli, 'test', target], { encoding: 'utf8' });
}

test('rank test runs test files and reports durations for each test', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-test-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

    fs.writeFileSync(path.join(temporary, 'simple_test.ra'), [
        'use testing',
        'test "first passes"',
        '  1 equal 1',
        'end',
        'test "second passes"',
        '  2 equal 2',
        'end',
    ].join('\n'));

    const result = runTest(temporary);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /ok .*simple_test\.ra: first passes \((?:<1|\d+)(?:ms|\.\d+s)\)/);
    assert.match(result.stdout, /ok .*simple_test\.ra: second passes \((?:<1|\d+)(?:ms|\.\d+s)\)/);
    assert.match(result.stdout, /1 files, 0 failed/);
});

test('rank test reports failing tests with duration and error', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-test-fail-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

    fs.writeFileSync(path.join(temporary, 'fail_test.ra'), [
        'use testing',
        'test "fails"',
        '  1 equal 2',
        'end',
    ].join('\n'));

    const result = runTest(temporary);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not ok .*fail_test\.ra: fails \((?:<1|\d+)(?:ms|\.\d+s)\)/);
    assert.match(result.stdout, /1 files, 1 failed/);
});


test('rank test skips compiled archives during discovery but accepts an explicit archived file', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-test-archive-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    fs.writeFileSync(path.join(temporary, 'simple_test.ra'), 'use testing\ntest "passes"\n  true\nend');
    const archive = path.join(temporary, 'compiled');
    fs.mkdirSync(archive);
    fs.writeFileSync(path.join(archive, 'rank-compile.json'), '{}');
    const archivedTest = path.join(archive, 'source_test.ra');
    fs.writeFileSync(archivedTest, 'use testing\ntest "fails"\n  false\nend');
    const discovered = runTest(temporary);
    assert.equal(discovered.status, 0, discovered.stderr);
    assert.match(discovered.stdout, /1 files, 0 failed/);
    assert.equal(runTest(archivedTest).status, 1);
});
