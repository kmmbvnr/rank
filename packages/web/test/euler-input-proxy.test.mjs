import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as httpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer, loadConfigFromFile } from 'vite';

test('Project Euler input route rewrites public document paths and keeps HTTP failures', async t => {
    const requests = [];
    const headers = [];
    const upstream = httpServer((request, response) => {
        requests.push(request.url);
        headers.push(request.headers);
        if (request.url === '/resources/documents/0022_names.txt') response.end('"COLIN","ABC","A"');
        else { response.writeHead(404); response.end('missing'); }
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    t.after(() => new Promise(resolve => upstream.close(resolve)));
    const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile);
    const config = loaded.config;
    const key = '^/__rank_euler/[A-Za-z0-9_.-]+$';
    assert.equal(config.server.proxy[key].target, 'https://projecteuler.net');
    assert.equal(config.preview.proxy[key].target, 'https://projecteuler.net');
    config.server.proxy[key].target = `http://127.0.0.1:${upstream.address().port}`;
    const vite = await createServer({ ...config, configFile: false,
        root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'silent',
        server: { ...config.server, host: '127.0.0.1', port: 0 } });
    t.after(() => vite.close());
    await vite.listen();
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const result = await fetch(base + '/__rank_euler/0022_names.txt', { headers: {
        Cookie: 'private-session', Origin: base, Referer: base + '/console.html',
        'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'empty',
    } });
    assert.equal(result.status, 200);
    assert.equal(await result.text(), '"COLIN","ABC","A"');
    assert.equal((await fetch(base + '/__rank_euler/missing.txt')).status, 404);
    await fetch(base + '/__rank_euler/not/a/document');
    assert.deepEqual(requests, ['/resources/documents/0022_names.txt', '/resources/documents/missing.txt']);
    assert.equal(headers[0]['accept-encoding'], 'identity');
    for (const name of ['cookie', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'])
        assert.equal(headers[0][name], undefined, name);
});
