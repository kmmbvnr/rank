import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const page = fileURLToPath(new URL('../../../docs/stdlib/reference.md', import.meta.url));

// The page is generated data. Regenerating it is one command, so a mismatch is
// a reminder rather than an error to reason about.
test('the stdlib reference page matches the catalogue', () => {
    const generated = spawnSync(process.execPath, [cli, 'ops', '--markdown'],
        { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    assert.equal(fs.readFileSync(page, 'utf8'), generated.stdout,
        'run `rank ops --markdown > docs/stdlib/reference.md`');
});
