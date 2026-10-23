// Build first. Each sample uses a fresh process; lookup timing excludes the oracle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
const option = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const cases = ['lookup-bounded', 'lookup-unbounded', 'lookup-dense', 'euler-original', 'euler-sieve'];
const limit = 100000001;
if (option('worker')) {
    const name = option('worker');
    assert.ok(cases.includes(name));
    if (name.startsWith('lookup-')) {
        const { primePlan } = await import('../packages/interpreter/out/prime-sequence.js');
        const { densePrimePlan } = await import('../packages/interpreter/out/dense-prime-sieve.js');
        let seed = 42;
        const values = Array.from({ length: 10000 }, () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return BigInt(3 + 2 * (seed % 49999999));
        });
        const isPrime = n => {
            for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
            return true; // Workload contains only odd integers >= 3.
        };
        const expected = values.map(n => isPrime(Number(n)));
        const start = performance.now();
        const plan = name === 'lookup-dense' ? densePrimePlan(BigInt(limit))
            : primePlan(name === 'lookup-bounded' ? { limit: BigInt(limit), inclusive: true } : undefined);
        const buildMs = performance.now() - start;
        const queryStart = performance.now();
        const actual = values.map(n => plan.contains(n));
        const queryMs = performance.now() - queryStart;
        assert.deepEqual(actual, expected);
        console.log(JSON.stringify({ case: name, buildMs, queryMs, totalMs: buildMs + queryMs,
            queries: values.length, hits: actual.filter(Boolean).length,
            bitmapBytes: name === 'lookup-dense' ? Math.ceil(Math.floor((limit + 1) / 2) / 8) : undefined }));
    } else {
        const { Interpreter } = await import('../packages/interpreter/out/index.js');
        const source = readFileSync(new URL(name === 'euler-original'
            ? './fixtures/357-primegenerating-original.ra' : '../demos/euler/357_primegenerating.ra', import.meta.url), 'utf8');
        const runtime = new Interpreter(() => {}), start = performance.now();
        try {
            runtime.execute(source);
            const executeMs = performance.now() - start;
            assert.equal(runtime.variables.get('Answer'), 1739023853137n);
            console.log(JSON.stringify({ case: name, executeMs, answer: String(runtime.variables.get('Answer')) }));
        } finally { runtime.dispose(); }
    }
} else {
    const trials = Number(option('trials') ?? 3), selected = option('cases')?.split(',');
    assert.ok(Number.isInteger(trials) && trials > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
        timing: 'fresh processes; Euler includes parsing and sieve construction; lookup excludes oracle' }));
    for (const name of cases.filter(x => !selected || selected.includes(x))) {
        const samples = [];
        for (let trial = 0; trial < trials; trial++) {
            const result = spawnSync(process.execPath, [import.meta.filename, `--worker=${name}`],
                { encoding: 'utf8', timeout: 30000 });
            assert.ifError(result.error);
            assert.equal(result.status, 0, result.stderr);
            const sample = { ...JSON.parse(result.stdout), trial };
            samples.push(sample); console.log(JSON.stringify(sample));
        }
        const summary = { case: name };
        for (const key of ['buildMs', 'queryMs', 'totalMs', 'executeMs']) {
            if (samples[0][key] !== undefined) summary[`median${key[0].toUpperCase()}${key.slice(1)}`]
                = samples.map(x => x[key]).sort((a, b) => a - b)[Math.floor(trials / 2)];
        }
        console.log(JSON.stringify(summary));
    }
}
