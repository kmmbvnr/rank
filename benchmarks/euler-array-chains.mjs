import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Issue 402's input sizes, with explicit copy versus ordinary eager bindings.
// Build first. Every sample runs in a fresh process with compilation enabled.
if (process.argv[2] === '--worker') {
    const { Interpreter } = await import('../packages/interpreter/out/index.js');
    const [name, n, variant] = process.argv.slice(3);
    assert(['407_idempotents', '408_admissiblepaths'].includes(name));
    assert(['copy', 'ordinary'].includes(variant));
    assert(Number.isSafeInteger(Number(n)) && Number(n) > 0);
    const original = readFileSync(new URL(`../demos/euler/${name}.ra`, import.meta.url), 'utf8');
    const source = variant === 'copy' ? original : original.replace(/ copy\b/g, '');
    const output = [];
    const runtime = new Interpreter(text => output.push(text), { args: ['--n', n], compilation: true });
    try {
        const start = performance.now();
        runtime.execute(source);
        const totalMs = performance.now() - start;
        const answer = runtime.variables.get('Answer');
        assert.equal(typeof answer, 'bigint');
        assert.deepEqual(output, [answer.toString()]);
        console.log(JSON.stringify({ name, n: Number(n), variant, totalMs, answer: answer.toString(),
            sourceHash: createHash('sha256').update(source).digest('hex'),
            peakRssKiB: process.resourceUsage().maxRSS, compilation: true }));
    } finally { runtime.dispose(); }
} else {
    const rows = [];
    for (let sample = 0; sample < 2; sample++) {
        for (const [name, n] of [['407_idempotents', 200000], ['407_idempotents', 1600000], ['408_admissiblepaths', 1000000]]) {
            for (const variant of sample ? ['ordinary', 'copy'] : ['copy', 'ordinary']) {
                const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', name, String(n), variant],
                    { encoding: 'utf8', timeout: 180_000 });
                assert.ifError(result.error);
                assert.equal(result.status, 0, result.stderr || result.stdout);
                const row = { sample, ...JSON.parse(result.stdout) };
                rows.push(row);
                console.log(JSON.stringify(row));
            }
        }
    }
    for (const row of rows) {
        assert(rows.filter(other => other.name === row.name && other.n === row.n).every(other => other.answer === row.answer));
    }
}
