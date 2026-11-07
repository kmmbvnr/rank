import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const limit = process.argv[2] ?? '100000';
const source = readFileSync(new URL('./experiments/compiled-compound-scatter.ra', import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { args: [`--n=${limit}`] });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const n = BigInt(limit), answer = runtime.variables.get('Answer');
    assert.equal(answer, n * (n - 1n) / 2n + (n + 1n) / 2n * 300n);
    console.log(JSON.stringify({ limit, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms,
        rssMiB: process.resourceUsage().maxRSS / 1024, answer: String(answer), diagnostics }));
} finally { runtime.dispose(); }
