import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

function check(directory) {
    return spawnSync(process.execPath, [cli, 'check', directory], { encoding: 'utf8' });
}

test('check parses every program and reports the ones that do not', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-check-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    fs.mkdirSync(path.join(temporary, 'nested'));
    fs.writeFileSync(path.join(temporary, 'good.ra'), 'use numbers\nA = 1 + 2\n');
    fs.writeFileSync(path.join(temporary, 'nested', 'also_good.ra'),
        'fun double X\n  return X * 2\nend\n');

    const passing = check(temporary);
    assert.equal(passing.status, 0);
    assert.match(passing.stdout, /2 files, 0 failed/);
    assert.equal(passing.stderr, '');

    // A statement cannot continue onto the next line outside brackets.
    fs.writeFileSync(path.join(temporary, 'broken.ra'), 'A =\n  1 + 2\n');
    const failing = check(temporary);
    assert.equal(failing.status, 1);
    assert.match(failing.stdout, /3 files, 1 failed/);
    assert.match(failing.stderr, /broken\.ra/);
    assert.match(failing.stderr, /Syntax/);
});

test('check needs something to check', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-empty-'));
    const result = check(temporary);
    fs.rmSync(temporary, { recursive: true, force: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no \*\.ra files found/);
});

test('check explains the removed DSU find spelling', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-check-rename-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const file = path.join(temporary, 'old-dsu.ra');
    for (const modules of ['use graph', 'use graph\nuse sequences']) {
        for (const call of ['D find "a"', 'D "a" find']) {
            fs.writeFileSync(file, `${modules}\nD = new dsu (array "a")\n${call}\n`);
            const result = check(file);
            assert.equal(result.status, 1);
            assert.match(result.stderr, /DSU find is now findroot/);
        }
    }
    fs.writeFileSync(file, 'use graph\nD = new dsu (array "a")\nD findroot "a"\n');
    assert.equal(check(file).status, 0);
});
