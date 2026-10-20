import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, mock } from 'node:test';
import { localDemoWorkers, canShardLocally, runLocalDemoAudit } from './local-demo-audits.mjs';

const gibibyte = 1024 ** 3;

test('local concurrency uses CPU and memory limits, with a serial CI path', () => {
    assert.equal(localDemoWorkers({}, 10, 16 * gibibyte), 8);
    assert.equal(localDemoWorkers({}, 2, 16 * gibibyte), 1);
    assert.equal(localDemoWorkers({}, 32, 4 * gibibyte), 2);
    assert.equal(localDemoWorkers({ RANK_DEMO_WORKERS: '3' }, 10, 16 * gibibyte), 3);
    assert.equal(localDemoWorkers({ CI: 'true', RANK_DEMO_WORKERS: '8' }, 10, 16 * gibibyte), 1);
    assert.equal(canShardLocally('types', { CI: 'true' }), false);
    assert.equal(canShardLocally('types', { RANK_DEMO_WORKERS: '8', RANK_TYPE_AUDIT_SHARDS: '4' }), false);
    for (const value of ['0', '-1', '1.5', 'NaN']) assert.throws(() => localDemoWorkers({ RANK_DEMO_WORKERS: value }), /positive integer/);
});

async function fixture(mode, check) {
    const directory = mkdtempSync(join(tmpdir(), 'rank-shard-test-'));
    const worker = join(directory, 'worker.mjs'), trace = join(directory, 'trace');
    writeFileSync(worker, `import { appendFileSync, writeFileSync } from 'node:fs';
        const shard = Number(process.env.RANK_TYPE_AUDIT_SHARD);
        appendFileSync(${JSON.stringify(trace)}, shard + ' start\\n');
        setTimeout(() => {
            appendFileSync(${JSON.stringify(trace)}, shard + ' stop\\n');
            writeFileSync(process.env.RANK_TYPE_AUDIT_SUMMARY, JSON.stringify({ shard,
                shardCount: Number(process.env.RANK_TYPE_AUDIT_SHARDS), ran: 200, names: 200, settled: 200 }));
            ${mode === 'missing' ? "if (shard === 1) writeFileSync(process.env.RANK_TYPE_AUDIT_SUMMARY, '{}');" : ''}
            process.exit(${mode === 'failure' ? 'shard === 1 ? 1 : 0' : '0'});
        }, 500);
    `);
    const log = mock.method(console, 'log', () => {}), error = mock.method(console, 'error', () => {});
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = directory;
    try { await check(await runLocalDemoAudit('types', worker, 3), readFileSync(trace, 'utf8')); }
    finally {
        log.mock.restore();
        error.mock.restore();
        if (previous === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previous;
        rmSync(directory, { recursive: true, force: true });
    }
}

test('shards execute concurrently and all results enter the coverage gate', async () => {
    await fixture('success', (passed, trace) => {
        assert.equal(passed, true);
        let active = 0, maximum = 0;
        const started = new Set(), stopped = new Set();
        for (const line of trace.trim().split('\n')) {
            const [shard, operation] = line.split(' ');
            if (operation === 'start') { started.add(shard); active++; maximum = Math.max(maximum, active); }
            else { stopped.add(shard); active--; }
        }
        assert.ok(maximum > 1, 'workers must overlap');
        assert.deepEqual([...started].sort(), ['0', '1', '2']);
        assert.deepEqual(stopped, started);
        assert.equal(active, 0);
    });
});

test('a failing worker fails the audit', async () => {
    await fixture('failure', passed => assert.equal(passed, false));
});

test('successful workers with incomplete summaries still fail coverage', async () => {
    await fixture('missing', passed => assert.equal(passed, false));
});
