import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { analyzeWithImports } from '@rank/language';
import { parse } from '@rank/interpreter';
import { loadModule } from '../out/load-module.js';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const demos = fileURLToPath(new URL('../../../demos', import.meta.url));

function explain(file) {
    return spawnSync(process.execPath, [cli, 'explain', file], { encoding: 'utf8' });
}

test('explain reports scopes, reads and writes', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-explain-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const file = path.join(temporary, 'sums.ra');
    fs.writeFileSync(file, [
        'use io', 'use ranges',
        'Total = 0',
        'Spare = 7',
        'for I in 1 to 10',
        '  Total = Total + I',
        'end',
        'Total print',
        '',
    ].join('\n'));

    const result = explain(file);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /io ranges/);
    assert.match(result.stdout, /Total .*assignment.*loop-carried/);
    assert.match(result.stdout, /Spare .*never read/);
    assert.match(result.stdout, /I +loop/);
    assert.match(result.stdout, /print +io/);
});

test('explain names a missing use and exits nonzero', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-explain-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const file = path.join(temporary, 'root.ra');
    fs.writeFileSync(file, 'A = 9 sqrt\nA print\n');

    const result = explain(file);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /needs a use/);
    assert.match(result.stdout, /sqrt +numbers/);
    assert.match(result.stdout, /print +io/);
});

test('explain borrows the names of a loaded source module', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-explain-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    fs.writeFileSync(path.join(temporary, 'twice.ra'),
        'fun twice X\n  return X * 2\nend\n');
    const file = path.join(temporary, 'main.ra');
    fs.writeFileSync(file, 'use "twice"\nA = 3 twice\nB = A\n');

    const result = explain(file);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /unresolved/);
});

// The corpus is the real test: every demo runs, so every report here is a
// false positive and the whole suite would be worthless with one in it. The
// command spawns a process per file, so this runs the same analysis in-process.
test('explain finds nothing to report across the demos', () => {
    const files = [];
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.ra')) files.push(full);
        }
    };
    walk(demos);
    assert.ok(files.length > 600, `only ${files.length} demo files`);

    const reported = [];
    for (const file of files) {
        let facts;
        try {
            facts = analyzeWithImports(
                parse(fs.readFileSync(file, 'utf8')),
                specifier => parse(loadModule(specifier, file).source));
        } catch {
            continue; // `rank check` owns parse failures.
        }
        for (const use of [...facts.missing, ...facts.words]) {
            reported.push(`${path.relative(demos, file)}: ${use.name}`);
        }
    }
    assert.deepEqual(reported, []);
});
