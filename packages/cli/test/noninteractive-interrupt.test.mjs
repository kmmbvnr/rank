import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

test('file and piped execution never start an interactive worker or poll its cancellation signal', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-noninteractive-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const preload = path.join(directory, 'no-interactive.mjs');
    fs.writeFileSync(preload, `
import workers from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
workers.Worker = class { constructor() { throw new Error('unexpected interactive worker'); } };
syncBuiltinESMExports();
Atomics.exchange = () => { throw new Error('unexpected cancellation polling'); };
`);
    const source = 'use numbers\nuse io\n3000 2 binomial print\n';
    const file = path.join(directory, 'program.ra');
    fs.writeFileSync(file, source);
    for (const [args, input] of [[[file], undefined], [[], source]]) {
        const result = spawnSync(process.execPath, ['--import', preload, cli, ...args], {
            encoding: 'utf8', input, timeout: 10000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stderr, '');
        assert.match(result.stdout, /4498500/);
        assert.doesNotMatch(result.stdout, /Running|Ctrl-C|\x1b/);
    }
});
