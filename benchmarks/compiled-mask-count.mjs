import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const workload = process.argv[2] ?? 'numeric';
assert.ok(['numeric', 'bitmap', 'boolean'].includes(workload));
const size = workload === 'numeric' ? 128 : 1000000;
const repeats = workload === 'numeric' ? 100000 : 20;
const source = readFileSync(new URL(`./experiments/compiled-count-${workload}.ra`, import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    let expected = 0n;
    if (workload === 'numeric') {
        const counts = Array(7).fill(0n);
        for (let value = 0; value < size; value++) counts[value % 7]++;
        for (let turn = 1; turn <= repeats; turn++) expected += counts[turn % 7];
    } else expected = BigInt(repeats * size / 10000);
    assert.equal((runtime.variables.get('Answer') ?? runtime.lastResult), expected);
    console.log(JSON.stringify({ workload, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer: String(expected), diagnostics }));
} finally { runtime.dispose(); }
