import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../packages/interpreter/out/index.js';

// Build first. Each sample runs in a fresh process; do not overlap with tests.
const worker = process.argv.find(arg => arg.startsWith('--worker='))?.slice(9);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (worker) {
    let source = readFileSync(new URL('../demos/euler/008_seriesproduct.ra', import.meta.url), 'utf8')
        .replace('Answer print', 'Answer');
    if (worker === 'builtin') source = 'use sequences\n' + source
        .replace(/fun Values window Width[\s\S]*?\nend\n/, '')
        .replace('Digits window Width array', 'Digits window Width');
    const samples = [];
    for (let i = 0; i < 15; i++) {
        const runtime = new Interpreter();
        try {
            const start = performance.now();
            assert.equal(runtime.execute(source), 23514624000n);
            if (i >= 10) samples.push(performance.now() - start);
        } finally { runtime.dispose(); }
    }
    console.log(JSON.stringify({ samples, median: median(samples) }));
} else {
    const results = { builtin: [], custom: [] };
    for (let i = 0; i < 5; i++) {
        const order = i % 2 ? ['custom', 'builtin'] : ['builtin', 'custom'];
        for (const name of order) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`],
                { encoding: 'utf8', timeout: 60000 });
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            results[name].push(JSON.parse(child.stdout));
        }
    }
    console.log(JSON.stringify({ node: process.version, measurement: 'parse + execution, 10 warmups, 5 runs per process',
        results, medians: Object.fromEntries(Object.entries(results).map(([name, values]) =>
            [name, median(values.map(value => value.median))])) }, null, 2));
}
