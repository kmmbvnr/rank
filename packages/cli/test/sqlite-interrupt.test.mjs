import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import test from 'node:test';
import { createWorkerSession } from '../out/worker-session.js';

const longRead = 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) AS answer FROM n';
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-sqlite-interrupt-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, 'test.sqlite');
    const db = new Database(filename);
    db.exec('CREATE TABLE items(value INTEGER)');
    db.close();
    return { directory, filename };
}

async function connection(t, filename) {
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(new URL('./fixtures/sqlite-interrupt-worker.mjs', import.meta.url), {
        workerData: { signal: signal.buffer, path: filename },
    });
    t.after(async () => { Atomics.store(signal, 0, 1); await worker.terminate(); });
    const pending = new Map();
    let serial = 0;
    let ready, failed;
    const started = new Promise((resolve, reject) => { ready = resolve; failed = reject; });
    worker.on('error', error => { failed(error); for (const entry of pending.values()) entry.reject(error); pending.clear(); });
    worker.on('message', message => {
        if (message.ready) return ready();
        pending.get(message.id)?.resolve(message);
        pending.delete(message.id);
    });
    await started;
    return {
        async query(sql, cancel = false) {
            const id = serial++;
            Atomics.store(signal, 0, 0);
            const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
            worker.postMessage({ id, sql });
            const timer = cancel ? setTimeout(() => Atomics.store(signal, 0, 1), 50) : undefined;
            try { return await result; } finally { clearTimeout(timer); }
        },
    };
}

test('SQLite interrupts a running SELECT and the same connection remains usable', { timeout: 10000 }, async t => {
    const { filename } = fixture(t);
    const db = await connection(t, filename);
    for (let attempt = 0; attempt < 3; attempt++) {
        const started = performance.now();
        const stopped = await db.query(longRead, true);
        assert.equal(stopped.interrupted, true, stopped.error);
        assert.match(stopped.error, /executing SQLite query/);
        assert.ok(performance.now() - started < 3000, 'cancellation did not return promptly');
        assert.deepEqual((await db.query('SELECT 42 AS answer')).result, [{ answer: 42n }]);
    }
});

test('interrupted SQLite writes roll back their transaction and release the connection', { timeout: 10000 }, async t => {
    const { filename } = fixture(t);
    const db = await connection(t, filename);
    assert.equal((await db.query('BEGIN')).error, undefined);
    assert.equal((await db.query('INSERT INTO items VALUES (7)')).error, undefined);
    const stopped = await db.query('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000000) INSERT INTO items SELECT x FROM n', true);
    assert.equal(stopped.interrupted, true, stopped.error);
    assert.deepEqual((await db.query('SELECT count(*) AS count FROM items')).result, [{ count: 0n }]);
    assert.equal((await db.query('INSERT INTO items VALUES (42)')).error, undefined);
    assert.deepEqual((await db.query('SELECT value FROM items')).result, [{ value: 42n }]);
});

test('Rank CLI translates SQL cancellation and keeps database bindings for the next query', { timeout: 10000 }, async t => {
    const { filename } = fixture(t);
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    assert.equal((await session.execute(`use tables\nDb = ${JSON.stringify(filename)} sqlite`, 0, [])).ok, true);
    const running = session.execute(`Db ${JSON.stringify(longRead)} (array shape 0 fill 0) sqlquery array`, 1, []);
    const timer = setTimeout(() => session.interrupt(), 100);
    let stopped;
    try { stopped = await running; } finally { clearTimeout(timer); }
    assert.equal(stopped.interrupted, true, JSON.stringify(stopped.output));
    assert.match(stopped.output.map(line => line.text).join('\n'), /executing SQLite query/);
    const next = await session.execute('Rows = Db "SELECT 42 AS answer" (array shape 0 fill 0) sqlquery array\nRows .answer', 2, []);
    assert.equal(next.ok, true, JSON.stringify(next.output));
    assert.equal(next.output.at(-1).text, '42');
});

test('ordinary SQLite file and pipe execution never load the cancellation bridge', t => {
    const { filename, directory } = fixture(t);
    const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
    const preload = path.join(directory, 'no-extension.mjs');
    fs.writeFileSync(preload, `import {createRequire} from 'node:module';\nconst require=createRequire(${JSON.stringify(cli)});\nrequire('better-sqlite3').prototype.loadExtension=()=>{throw new Error('unexpected cancellation extension')};\n`);
    const source = `use tables\nuse io\nDb = ${JSON.stringify(filename)} sqlite\nRows = Db "SELECT 42 AS answer" (array shape 0 fill 0) sqlquery array\nRows .answer print\n`;
    const file = path.join(directory, 'query.ra');
    fs.writeFileSync(file, source);
    for (const [args, input] of [[[file], undefined], [[], source]]) {
        const result = spawnSync(process.execPath, ['--import', preload, cli, ...args], { input, encoding: 'utf8', timeout: 10000 });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /42/);
    }
});

test('SQLite cancellation is isolated between simultaneous interactive workers', { timeout: 10000 }, async t => {
    const { filename } = fixture(t);
    const first = await connection(t, filename);
    const second = await connection(t, filename);
    const [stopped, completed] = await Promise.all([
        first.query(longRead, true),
        second.query(longRead.replace('1000000000', '1000000')),
    ]);
    assert.equal(stopped.interrupted, true, stopped.error);
    assert.deepEqual(completed.result, [{ answer: 500000500000n }]);
});

test('disposing the CLI while SQLite is running interrupts before worker teardown', { timeout: 10000 }, async t => {
    const { filename } = fixture(t);
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    await session.execute(`use tables\nDb = ${JSON.stringify(filename)} sqlite`, 0, []);
    const running = session.execute(`Db ${JSON.stringify(longRead)} (array shape 0 fill 0) sqlquery array`, 1, []);
    const settled = running.catch(error => error);
    await new Promise(resolve => setTimeout(resolve, 100));
    const started = performance.now();
    await session.dispose();
    await settled;
    assert.ok(performance.now() - started < 3000, 'worker teardown waited for the full SQL query');
});

test('a pending SQLite pause remains cancellable', { timeout: 10000 }, async t => {
    const { filename } = fixture(t);
    const session = await createWorkerSession();
    t.after(() => session.dispose());
    assert.equal((await session.execute(`use tables\nDb = ${JSON.stringify(filename)} sqlite`, 0, [])).ok, true);
    const running = session.execute(`Db ${JSON.stringify(longRead)} (array shape 0 fill 0) sqlquery array`, 1, []);
    await new Promise(resolve => setTimeout(resolve, 80));
    session.pause();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(session.pauseRequested, true);
    assert.equal(session.pauseState, undefined, 'a native query cannot suspend inside SQLite');
    session.interrupt();
    assert.equal((await running).interrupted, true);
    assert.equal(session.pauseRequested, false);
    assert.equal((await session.execute('21 * 2', 2, [])).ok, true);
});
