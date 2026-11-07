import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const workload = process.argv[2] ?? 'fused';
const files = { fused: 'indices', bitmap: 'bitmap', predicate: 'predicate' };
assert.ok(workload in files);
const limit = process.argv[3] ?? (workload === 'fused' ? '10000' : '1000000');
const source = readFileSync(new URL(`./experiments/compiled-mask-${files[workload]}.ra`, import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { args: [`--n=${limit}`] });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start, rssMiB = process.resourceUsage().maxRSS / 1024;
    let expected = 0n;
    if (workload === 'fused') {
        const totals = Array(7).fill(0n);
        for (let value = 0; value < 128; value++) totals[value % 7] += BigInt(value);
        for (let turn = 1; turn <= Number(limit); turn++) expected += totals[turn % 7];
    } else {
        for (let value = 0; value < Number(limit); value += 10000) expected += 20n * BigInt(value);
    }
    const answer = runtime.variables.get('Answer');
    assert.equal(answer, expected);
    console.log(JSON.stringify({ workload, limit, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms, rssMiB,
        answer: String(answer), diagnostics }));
} finally { runtime.dispose(); }
