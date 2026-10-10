// Build first: node benchmarks/memo-cache-hits.mjs [samples] [size] [array|sequence]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createArraySnapshot, Interpreter } from '../packages/interpreter/out/index.js';

const samples = Number(process.argv[2] ?? 3);
const size = Number(process.argv[3] ?? 200000);
const form = process.argv[4] ?? 'array';
const mode = process.argv[5];
assert(Number.isSafeInteger(samples) && samples > 0);
assert(Number.isSafeInteger(size) && size > 0);
assert(['array', 'sequence'].includes(form));
assert(mode === undefined || ['reference', 'callback'].includes(mode));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (mode) {
    const runtime = new Interpreter(() => {}, { scalarFunctionCompilation: mode === 'callback' });
    try {
        // Fill every argument before timing. No function bodies run in a measured pass.
        runtime.execute(`memo value N rank 0\n return N + 1\nend\nWarm = 1 to ${size} value sum`);
        const expected = BigInt(size) * (BigInt(size) + 3n) / 2n;
        assert.equal(runtime.variables.get('Warm'), expected);
        if (form === 'array') runtime.variables.set('Source',
            createArraySnapshot(Array.from({ length: size }, (_, index) => BigInt(index + 1))));
        else runtime.execute(`Source = 1 to ${size}`);
        const ms = [];
        for (let pass = 0; pass < 5; pass++) {
            global.gc();
            const start = performance.now();
            runtime.execute('Mapped = Source value\nAnswer = Mapped sum');
            ms.push(performance.now() - start);
            assert.equal(runtime.variables.get('Answer'), expected);
        }
        global.gc();
        console.log(JSON.stringify({ ms, medianMs: median(ms), heapUsed: process.memoryUsage().heapUsed }));
    } finally { runtime.dispose(); }
} else {
    const records = [];
    for (let sample = 0; sample < samples; sample++) {
        for (const variant of sample % 2 ? ['callback', 'reference'] : ['reference', 'callback']) {
            const child = spawnSync(process.execPath,
                ['--expose-gc', fileURLToPath(import.meta.url), '1', String(size), form, variant],
                { encoding: 'utf8', timeout: 120000 });
            assert.equal(child.status, 0, child.error?.message ?? child.stderr);
            records.push({ sample, variant, ...JSON.parse(child.stdout) });
        }
    }
    const medians = Object.fromEntries(['reference', 'callback'].map(variant => [variant,
        median(records.filter(record => record.variant === variant).map(record => record.medianMs))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, size, samples, form,
        method: 'fresh processes, alternating modes, five cached passes per process; filling the memo cache and GC excluded; reference disables scalar callbacks; heapUsed is total live heap after GC, not peak',
        records, medians }, null, 2));
}
