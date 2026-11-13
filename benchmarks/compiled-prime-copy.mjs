import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const limit = process.argv[2] ?? '10000';
const source = readFileSync(new URL('./experiments/euler445-prime-copy-loop.ra', import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { args: [`--n=${limit}`] });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start, rssMiB = process.resourceUsage().maxRSS / 1024;
    let expected = 0n;
    for (let i = 1; i <= Number(limit); i++) for (let p = 10; p <= 80 + i % 20; p++) {
        let prime = true;
        for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
        if (prime) expected += BigInt(p);
    }
    const answer = (runtime.variables.get('Answer') ?? runtime.lastResult);
    assert.equal(answer, expected);
    console.log(JSON.stringify({ limit, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms, rssMiB, answer: String(answer), diagnostics }));
} finally { runtime.dispose(); }
