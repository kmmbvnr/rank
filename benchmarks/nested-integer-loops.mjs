// Each sample runs in a fresh process. Timing excludes the independent oracles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const limit = Number(option('limit') ?? 100000000);
const trials = Number(option('trials') ?? 3);
const cases = (option('cases') ?? 'division,sieve,original,current').split(',');
const runtimePath = option('runtime') ?? new URL('../packages/interpreter/out/index.js', import.meta.url).href;
assert.ok(Number.isSafeInteger(limit) && limit >= 3);
assert.ok(Number.isInteger(trials) && trials > 0);
if (option('worker')) {
    const name = option('worker');
    const { Interpreter, RuntimeDiagnostics } = await import(runtimePath);
    const { readArrayItem } = await import(new URL('./array-storage.js', runtimePath));
    let source = readFileSync(new URL(name === 'current' ? '../demos/euler/370_triangles.ra'
        : './fixtures/370-triangles-original.ra', import.meta.url), 'utf8')
        .replace(/option Limit integer = \d+/, `Limit = ${limit}`)
        .replace('Answer print', '');
    if (name === 'sieve') source = source.replace(/  Sum = 0\n  for P in 1 to Top[\s\S]*?  return Sum/, '  return Spf');
    if (name === 'division') source = `Sum = 0\nDividend = 100000000000000\nfor I in 1 to 1000000\n Sum += Dividend // I\nend\nAnswer = Sum`;
    const runtime = new Interpreter(() => {}), diagnostics = option('diagnostics') ? new RuntimeDiagnostics() : undefined;
    // Keep parser startup from obscuring this short arithmetic microbenchmark.
    if (name === 'division') runtime.execute('Setup = 0');
    const start = performance.now();
    try {
        const run = () => runtime.execute(source);
        if (diagnostics) diagnostics.run(run); else run();
        const executeMs = performance.now() - start, answer = runtime.variables.get('Answer');
        if (name === 'sieve') {
            const top = Math.floor(Math.sqrt(Math.floor(limit / 3))), expected = new Int32Array(top + 1);
            expected[1] = 1;
            for (let p = 2; p <= top; p++) if (!expected[p]) {
                for (let q = p; q <= top; q += p) if (!expected[q]) expected[q] = p;
            }
            assert.deepEqual(answer.shape, [top + 1]);
            for (let i = 0; i <= top; i++) assert.equal(readArrayItem(answer, i), BigInt(expected[i]));
        } else if (name === 'division') {
            let expected = 0n;
            for (let i = 1n; i <= 1000000n; i++) expected += 100000000000000n / i;
            assert.equal(answer, expected);
        } else {
            let expected;
            if (limit === 25000000000000) expected = 41791929448408n;
            else {
                assert.ok(limit <= 100000000, 'use a small input for the independent exhaustive oracle');
                const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
                let sum = 0;
                for (let p = 1; 3 * p * p <= limit; p++) {
                    for (let q = p; q * q < p * p + p * q && p * p + p * q + q * q <= limit; q++) {
                        if (gcd(p, q) === 1) sum += Math.floor(limit / (p * p + p * q + q * q));
                    }
                }
                expected = BigInt(sum);
            }
            assert.equal(answer, expected);
        }
        console.log(JSON.stringify({ case: name, limit, sourceSha256: createHash('sha256').update(source).digest('hex'),
            executeMs, answer: name === 'sieve' ? undefined : String(answer), diagnostics }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, runtimePath,
        timing: 'fresh processes; includes parsing, allocation and execution; excludes oracle; division warms parser before timing' }));
    for (const name of cases) {
        assert.ok(['division', 'sieve', 'original', 'current'].includes(name));
        const samples = [];
        for (let trial = 1; trial <= trials; trial++) {
            const args = [import.meta.filename, `--worker=${name}`, `--limit=${limit}`, `--runtime=${runtimePath}`];
            if (option('diagnostics')) args.push('--diagnostics=yes');
            const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: Number(option('timeout') ?? 30000) });
            if (result.error?.code === 'ETIMEDOUT') {
                console.log(JSON.stringify({ case: name, limit, trial, timeoutMs: Number(option('timeout') ?? 30000) }));
                break;
            }
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stderr);
            const sample = { ...JSON.parse(result.stdout), trial };
            samples.push(sample.executeMs); console.log(JSON.stringify(sample));
        }
        if (samples.length === trials) console.log(JSON.stringify({ case: name, limit,
            medianExecuteMs: samples.sort((a, b) => a - b)[Math.floor(trials / 2)] }));
    }
}
