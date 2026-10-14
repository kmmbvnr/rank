import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerSession } from '../out/worker-session.js';
import { nodeEnvironment } from '../out/node-environment.js';

test('direct CLI snapshots inherited values without modifying the parent environment', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rank-env-'));
    try {
        const path = join(directory, 'env.ra');
        writeFileSync(path, 'use cli\nuse io\n"RANK_ENV_TEST" env print\nenv "RANK_ENV_TEST" = "changed"\n"RANK_ENV_TEST" env print\nenv "RANK_ENV_TEST" = .NA\n("RANK_ENV_TEST" env default "absent") print');
        const output = execFileSync(process.execPath, ['packages/cli/bin/cli.js', path], {
            cwd: new URL('../../..', import.meta.url), encoding: 'utf8', env: { ...process.env, RANK_ENV_TEST: 'inherited' },
        });
        assert.equal(output.trim(), 'inherited\nchanged\nabsent');
    } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('workers preserve session writes across execution restart and clear them on notebook reset', async t => {
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    const execute = async source => (await session.execute(source, 0, [], 40, true)).output.map(line => line.text);
    assert.deepEqual(await execute('use cli\nenv "RANK_ENV_WORKER_TEST" = "worker"'), ['worker']);
    assert.equal(process.env.RANK_ENV_WORKER_TEST, undefined);
    await session.resetExecution();
    assert.deepEqual(await execute('use cli\n"RANK_ENV_WORKER_TEST" env'), ['worker']);
    await execute('e = env\nName = "RANK_ENV_WORKER_TEST"');
    assert.deepEqual(await execute('e Name = "alias"\nName env'), ['alias']);
    await session.resetExecution(true);
    assert.deepEqual(await execute('use cli\n"RANK_ENV_WORKER_TEST" env default "empty"'), ['empty']);
});

test('main and worker host adapters can use the same Windows case policy', () => {
    const environment = nodeEnvironment({ Host: 'value', __proto__: 'ignored by object construction' }, true);
    assert.equal(environment.get('HOST'), 'value');
    environment.set('host', undefined);
    assert.equal(environment.get('Host'), undefined);
});
