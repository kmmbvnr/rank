import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { Interpreter } from '@arrrank/interpreter';
import { nodeIo } from '../out/node-io.js';

// A separate event loop can serve requests while NodeIo waits synchronously.
test('URL inputs support text, bytes, redirects and read-only handles', async t => {
    const server = new Worker(`
        const { parentPort } = require('node:worker_threads');
        const { createServer } = require('node:http');
        const server = createServer((request, response) => {
            if (request.url === '/redirect') { response.writeHead(302, { Location: '/names' }); response.end(); }
            else if (request.url === '/missing') { response.writeHead(404); response.end('missing'); }
            else if (request.url === '/bytes') response.end(Buffer.from([0, 255, 128, 65]));
            else response.end('"COLIN","ABC","A"');
        });
        server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
    `, { eval: true });
    t.after(() => server.terminate());
    const [port] = await once(server, 'message');
    const base = `http://127.0.0.1:${port}`;
    const decode = data => new TextDecoder().decode(data);
    assert.equal(decode(nodeIo.read(base + '/redirect')), '"COLIN","ABC","A"');
    assert.deepEqual([...nodeIo.readRange(base + '/bytes', 1, 2)], [255, 128]);
    assert.throws(() => nodeIo.read(base + '/missing'), /HTTP 404/);
    assert.throws(() => nodeIo.write(base, new Uint8Array(), false), /read-only/);
    for (const mode of ['write', 'update', 'append']) assert.throws(() => nodeIo.open(base, mode), /read-only/);
    const file = nodeIo.open(base + '/bytes', 'read');
    assert.equal(file.size(), 4);
    assert.deepEqual([...file.read(2)], [0, 255]);
    assert.equal(file.position(), 2);
    file.seek(1);
    assert.deepEqual([...file.read(10)], [255, 128, 65]);
    assert.deepEqual([...file.read(1)], []);
    assert.throws(() => file.write(new Uint8Array()), /read-only/);
    file.close(); file.close();
    assert.throws(() => file.read(1), /closed/);
    const runtime = new Interpreter(() => {}, { io: nodeIo });
    t.after(() => runtime.dispose());
    assert.equal(runtime.execute(`use io\n"${base}/names" read`), '"COLIN","ABC","A"');
    assert.throws(() => runtime.execute(`"${base}/missing" read`), /HTTP 404/);
});
