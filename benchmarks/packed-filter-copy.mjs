import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const limit = process.argv[2] ?? '10000000';
const source = readFileSync(new URL('./experiments/euler445-filter-copy.ra', import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { compilation: true, args: [`--n=${limit}`] });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const half = BigInt(limit) / 2n;
    const answer = (runtime.variables.get('Answer') ?? runtime.lastResult);
    assert.equal(answer, half * (half + 1n) / 2n);
    console.log(JSON.stringify({ node: process.version, arch: process.arch, limit,
        ms, rssMiB: process.resourceUsage().maxRSS / 1024, answer: String(answer), diagnostics }));
} finally { runtime.dispose(); }
