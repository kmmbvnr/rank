import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [workload = 'concat', limit = '2000000'] = process.argv.slice(2);
assert.ok(['concat', 'broadcast'].includes(workload));
const source = readFileSync(new URL(`./experiments/euler445-column-${workload}.ra`, import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { compilation: false, args: [`--n=${limit}`] });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const n = BigInt(limit), answer = (runtime.variables.get('Answer') ?? runtime.lastResult);
    const expected = workload === 'concat' ? 5n * n * (n + 1n) / 2n : n * (n + 1n) + 4n * n;
    assert.equal(answer, expected);
    assert.equal(diagnostics.compiledLoops, 0);
    assert.equal(diagnostics.compiledTensors, 0);
    console.log(JSON.stringify({ workload, limit, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms, rssMiB: process.resourceUsage().maxRSS / 1024, answer: String(answer), diagnostics }));
} finally { runtime.dispose(); }
