// Build first. Each trial runs in a fresh process; queries exclude sieve setup.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = option('case') ?? 'count';
const limit = Number(option('limit') ?? 100000000);
const queries = Number(option('queries') ?? 10);
if (option('worker')) {
    const root = option('root') ? pathToFileURL(option('root') + '/') : new URL('../', import.meta.url);
    const { Interpreter } = await import(new URL('packages/interpreter/out/index.js', root));
    const runtime = new Interpreter(() => {});
    try {
        if (mode === 'count') {
            const start = performance.now();
            runtime.execute(`use sequences\nS = ${limit} primesieve`);
            const setupMs = performance.now() - start;
            const query = `Total = 0
for X in ${limit - queries + 1} to ${limit}
 Total += (S to X) len
end
Total`;
            const cold = performance.now();
            const checksum = runtime.execute(query);
            const coldQueryMs = performance.now() - cold;
            const now = performance.now();
            assert.equal(runtime.execute(query), checksum);
            const queryMs = performance.now() - now;
            assert.equal(runtime.execute('S len'), limit === 100000000 ? 5761455n : runtime.execute('primes to ' + limit + ' len'));
            console.log(JSON.stringify({ case: mode, limit, setupMs, coldQueryMs, queryMs, queries, checksum: String(checksum) }));
        } else {
            const source = readFileSync(new URL(option('original') ? './fixtures/386-antichain-original.ra' : '../demos/euler/386_antichain.ra', import.meta.url), 'utf8');
            runtime.execute(`Limit = ${limit}`);
            const start = performance.now();
            runtime.execute(source);
            const executeMs = performance.now() - start;
            const answer = String(runtime.variables.get('Answer'));
            const expected = { 10: '12', 100: '178', 1000: '2385', 10000: '29860', 100000: '357503', 1000000: '4153927', 100000000: '528755790' };
            if (expected[limit]) assert.equal(answer, expected[limit]);
            console.log(JSON.stringify({ case: mode, limit, executeMs, answer }));
        }
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, case: mode, limit, original: Boolean(option('original')) }));
    for (let trial = 0; trial < Number(option('trials') ?? 3); trial++) {
        const p = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2), '--worker=yes'],
            { encoding: 'utf8', timeout: Number(option('timeout') ?? 30000) });
        if (p.error?.code === 'ETIMEDOUT') {
            console.log(JSON.stringify({ trial, timeoutMs: Number(option('timeout') ?? 30000) }));
            break;
        }
        assert.ifError(p.error);
        assert.equal(p.status, 0, p.stderr);
        console.log(JSON.stringify({ trial, ...JSON.parse(p.stdout) }));
    }
}
