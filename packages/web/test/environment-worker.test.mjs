import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { build } from 'vite';

test('web worker environment protocol', { timeout: 30_000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'rank-web-env-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await build({
        configFile: false,
        logLevel: 'silent',
        build: {
            outDir: directory,
            emptyOutDir: false,
            minify: false,
            lib: { entry: fileURLToPath(new URL('../src/worker.ts', import.meta.url)),
                formats: ['es'], fileName: () => 'worker.mjs' },
        },
    });
    for (const shared of [false, true]) await t.test(`shared interrupt signal: ${shared}`, async t => {
        // Only adapt the Web Worker mailbox. The bundled production worker owns
        // session creation, dispatch, snapshots and all interpreter behavior.
        const worker = new Worker(`
            const { parentPort, workerData } = require('node:worker_threads');
            globalThis.self = {
                postMessage: data => parentPort.postMessage(data),
                addEventListener: (_, listener) => parentPort.on('message', data => listener({ data })),
            };
            import(workerData).catch(error => { throw error; });
        `, { eval: true, workerData: pathToFileURL(join(directory, 'worker.mjs')).href });
        t.after(() => worker.terminate());
        let id = 0;
        const request = async message => {
            const response = once(worker, 'message', { signal: AbortSignal.timeout(5000) });
            worker.postMessage(message);
            const [result] = await response;
            assert.equal(result.id, message.id ?? 0);
            assert.equal(result.error, undefined);
            return result.result;
        };
        await request(shared ? { signal: new SharedArrayBuffer(12) } : {});
        const call = (method, ...args) => request({ id: ++id, method, args });
        const execute = async source => {
            const result = await call('execute', source, 0, [], 40, true);
            assert.equal(result.ok, true, JSON.stringify(result.output));
            return result.output.map(line => line.text);
        };
        assert.deepEqual(await execute('use cli\n"HOST" env default "empty"'), ['empty']);
        assert.deepEqual(await execute('env "HOST" = "session"'), ['session']);
        assert.deepEqual(await execute('Name = "HOST"\ne = env\ne Name = "alias"'), ['alias']);
        const preview = await call('preview', 'env Name = "preview"\nName env');
        assert.equal(preview.ok, true);
        assert.deepEqual(preview.output.map(line => line.text), ['preview']);
        assert.deepEqual(await execute('Name env'), ['alias']);
        await call('resetExecution', false);
        assert.deepEqual(await execute('use cli\n"HOST" env'), ['alias']);
        await execute('env "HOST" = .NA');
        assert.deepEqual(await execute('"HOST" env default "absent"'), ['absent']);
        await execute('env "HOST" = "again"');
        await call('resetExecution', true);
        assert.deepEqual(await execute('use cli\n"HOST" env default "empty"'), ['empty']);
    });
});
