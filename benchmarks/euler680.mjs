import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root = new URL('../', import.meta.url);
const runtime = process.env.RANK_BENCH_RUNTIME
    ? pathToFileURL(process.env.RANK_BENCH_RUNTIME)
    : new URL('packages/interpreter/out/index.js', root);
const {Interpreter} = await import(runtime);
const [mode = 'batched', k = '3200', b = '800', n = '1000000000000000000'] = process.argv.slice(2);
const r = new Interpreter(() => {});
try {
    if (mode === 'scan') {
        r.execute('use sequences\nCells = array shape 1600 fill 600000000000000');
        const t = performance.now();
        r.execute('Total = 0\nfor J in 0 till 1000\n Cells 0 = 600000000000000 + J\n Prefix = Cells scan +\n Total += Prefix last\nend\nAnswer = Total');
        assert.equal(r.variables.get('Answer'), 960000000000000499500n);
        console.log(JSON.stringify({mode, ms: performance.now() - t, answer: String(r.variables.get('Answer'))}));
    } else {
        const file = mode === 'batched' ? 'benchmarks/fixtures/680-batched.ra' : 'demos/euler/680_yarragnisrever.ra';
        const source = readFileSync(new URL(file, root), 'utf8')
            .replace('arg Kk integer = 1000000', `arg Kk integer = ${k}`)
            .replace('arg Bt integer = 800', `arg Bt integer = ${b}`)
            .replace('arg Nn integer = 1000000000000000000', `arg Nn integer = ${n}`);
        const t = performance.now(), cpu = process.cpuUsage();
        r.execute(source);
        const ms = performance.now() - t, used = process.cpuUsage(cpu);
        const answer = String(r.variables.get('Answer'));
        if (n === '1000000000000000000') {
            const expected = {800: '2631975', 3200: '801393719', 12800: '5458811', 1000000: '563917241'}[k];
            if (expected) assert.equal(answer, expected);
        }
        console.log(JSON.stringify({mode, k, b, n, ms, cpuMs: (used.user + used.system) / 1000,
            rssMiB: process.resourceUsage().maxRSS / 1024, answer}));
    }
} finally { r.dispose(); }
