import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

// Run each size in a fresh process, bounding the complete workload as well as
// reporting grouping separately from the pair scan. Includes parse/prepare time.
if (process.argv[2] === '--index-worker') {
    const count = Number(process.argv[3] ?? 100000);
    assert(Number.isSafeInteger(count) && count > 0);
    const runtime = new Interpreter(() => {});
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(`use algo\nData = new index\nfor I in 0 till ${count}\n Data I 0 = I\nend`);
        const start = performance.now();
        const answer = diagnostics.run(() => runtime.execute(
            `Total = 0\nfor I in 0 till ${count}\n Total += Data I 0\nend\nTotal`));
        assert.equal(answer, BigInt(count) * BigInt(count - 1) / 2n);
        console.log(JSON.stringify({ count, phase: 'index-reads', ms: performance.now() - start,
            answer: String(answer), diagnostics }));
    } finally { runtime.dispose(); }
} else if (process.argv[2] === '--worker') {
    const limit = Number(process.argv[3]);
    const source = readFileSync(new URL('../demos/euler/309_ladders.ra', import.meta.url), 'utf8')
        .replace('option Limit integer = 1000000', `option Limit integer = ${limit}`);
    const split = source.indexOf('Answer = 0');
    assert(split > 0);
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {});
    try {
        for (const [phase, program] of [['group', source.slice(0, split)], ['pairs', source.slice(split)]]) {
            const start = performance.now();
            diagnostics.run(() => runtime.execute(program));
            console.log(JSON.stringify({ limit, phase, ms: performance.now() - start,
                peakRssKiB: process.resourceUsage().maxRSS, diagnostics }));
        }
        const answer = runtime.variables.get('Answer');
        const expected = new Map([[200, 5n], [1000, 76n], [10000, 1438n], [1000000, 210139n]]).get(limit);
        if (expected !== undefined) assert.equal(answer, expected);
        console.log(JSON.stringify({ limit, answer: String(answer) }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model }));
    const limits = process.argv.slice(2).map(Number);
    for (const limit of limits.length ? limits : [200, 1000, 10000, 1000000]) {
        assert(Number.isSafeInteger(limit) && limit > 1);
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', String(limit)],
            { encoding: 'utf8', timeout: 30000 });
        process.stdout.write(child.stdout);
        if (child.error?.code === 'ETIMEDOUT') {
            console.log(JSON.stringify({ limit, timeoutMs: 30000 }));
            process.exitCode = 1;
        } else {
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
        }
    }
}
