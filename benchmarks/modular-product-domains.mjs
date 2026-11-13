import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [mode = 'compiled', modulus = '1999998034', limit = '1000000'] = process.argv.slice(2);
const source = readFileSync(new URL('./experiments/modular-product-domains.ra', import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', args: [`--n=${limit}`, `--mod=${modulus}`] });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start, rssMiB = process.resourceUsage().maxRSS / 1024;
    let expected = 0n;
    const m = BigInt(modulus);
    for (let i = 0; i < Number(limit); i++) {
        const a = BigInt(i * 7919 + 2147483647) % m;
        const b = (a * 17n + 104729n) % m;
        expected += a * b % m;
    }
    const answer = (runtime.variables.get('Answer') ?? runtime.lastResult);
    assert.equal(answer, expected);
    console.log(JSON.stringify({ mode, modulus, limit, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'), ms, rssMiB,
        answer: String(answer), diagnostics }));
} finally { runtime.dispose(); }
