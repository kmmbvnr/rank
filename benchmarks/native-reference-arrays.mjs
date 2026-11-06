import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK_BENCH_RUNTIME
    ?? new URL('../packages/interpreter/out/index.js', import.meta.url));
const [workload = 'updates', limit = '2000000'] = process.argv.slice(2);
assert.ok(['updates', 'ranges'].includes(workload));
const file = workload === 'updates' ? 'euler445-native-updates.ra' : 'euler445-concat-ranges.ra';
const source = readFileSync(new URL(`./experiments/${file}`, import.meta.url), 'utf8');
const runtime = new Interpreter(() => {}, { compilation: false, args: [`--n=${limit}`] });
const diagnostics = new RuntimeDiagnostics();
try {
    const start = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const ms = performance.now() - start;
    const n = BigInt(limit), count = (n + 2n) / 3n;
    const expected = workload === 'updates' ? n * (n - 1n) / 2n + 3n * n
        : n * (n + 1n) + count * (2n + 3n * (count - 1n)) / 2n;
    const answer = runtime.variables.get('Answer');
    assert.equal(answer, expected);
    assert.equal(diagnostics.compiledLoops, 0);
    assert.equal(diagnostics.compiledTensors, 0);
    console.log(JSON.stringify({ workload, limit, node: process.version, arch: process.arch,
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        ms, rssMiB: process.resourceUsage().maxRSS / 1024, answer: String(answer), diagnostics }));
} finally { runtime.dispose(); }
