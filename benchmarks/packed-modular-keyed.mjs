import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const limit = process.argv[2] ?? '2000000';
const source = readFileSync(new URL('./experiments/euler445-keyed-modular.ra', import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { compilation: false, args: [`--n=${limit}`] });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const rssMiB = process.resourceUsage().maxRSS / 1024;
    const groups = Array(4096).fill(1n);
    for (let i = 0; i < Number(limit); i++) groups[i % 4096]
        = groups[i % 4096] * BigInt((i + 1) % 1009 + 1) % 1000000007n;
    const expected = groups.reduce((a, b) => a + b, 0n);
    const answer = runtime.variables.get('Answer');
    assert.equal(answer, expected);
    assert.equal(diagnostics.compiledLoops, 0);
    assert.equal(diagnostics.compiledTensors, 0);
    console.log(JSON.stringify({ node: process.version, arch: process.arch, limit,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms, rssMiB, answer: String(answer), diagnostics }));
} finally { runtime.dispose(); }
