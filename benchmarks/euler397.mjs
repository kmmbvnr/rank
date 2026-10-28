// Build first. --runtime selects another interpreter's out/index.js.
// Each sample uses a fresh process; source variants share that runtime.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const limit = Number(option('limit') ?? 100000);
const samples = Number(option('samples') ?? 3);
const timeout = Number(option('timeout') ?? 45000);
const workload = option('case') ?? 'demo';
const variant = option('variant') ?? 'batch';
assert(['factors', 'divisors', 'sieve', 'demo'].includes(workload));
assert(['recursive', 'batch'].includes(variant));
assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000000);
assert(Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(timeout) && timeout > 0);
const runtimeUrl = option('runtime') ? pathToFileURL(option('runtime')).href
    : new URL('../packages/interpreter/out/index.js', import.meta.url).href;
const hash = data => createHash('sha256').update(data).digest('hex');
if (!option('worker')) {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model,
        runtime: runtimeUrl, workload, variant, limit, samples, timeout,
        factorizerHash: hash(readFileSync(new URL('factorization.js', runtimeUrl))),
        numbersHash: hash(readFileSync(new URL('modules/numbers.js', runtimeUrl))),
        policy: 'fresh process per sample; execution includes parsing and sieve construction; reference checks excluded' }));
    const results = [];
    for (let sample = 0; sample < samples; sample++) {
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--worker=true'],
            { encoding: 'utf8', timeout });
        if (result.error?.code === 'ETIMEDOUT') {
            console.log(JSON.stringify({ sample, status: 'timeout', timeout }));
            process.exitCode = 1;
            continue;
        }
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr || result.stdout);
        const value = JSON.parse(result.stdout);
        results.push(value);
        console.log(JSON.stringify({ sample, ...value }));
    }
    if (results.length) {
        const median = key => results.map(result => result[key]).sort((a, b) => a - b)[Math.floor(results.length / 2)];
        console.log(JSON.stringify({ completed: results.length, medianMs: median('ms'), medianCpuMs: median('cpuMs') }));
    }
} else {
    const { Interpreter, isRankSequence, isNativeFunction } = await import(runtimeUrl);
    const { Factorizer } = await import(new URL('factorization.js', runtimeUrl));
    // Independent ordinary sieve supplies prime-factor and divisor-count checksums.
    const spf = new Uint32Array(limit + 1);
    for (let p = 2; p <= limit; p++) if (!spf[p]) {
        for (let n = p; n <= limit; n += p) if (!spf[n]) spf[n] = p;
    }
    let factorChecksum = 0n, divisorCount = 0;
    for (let n = 1; n <= limit; n++) {
        let rest = n, count = 2;
        while (rest > 1) {
            const p = spf[rest];
            let exponent = 0;
            do { rest /= p; exponent++; factorChecksum += 2n * BigInt(p); }
            while (rest > 1 && spf[rest] === p);
            count = p === 2 ? 2 * exponent + 2 : count * (2 * exponent + 1);
        }
        factorChecksum += 2n;
        divisorCount += count;
    }
    const runtime = new Interpreter(() => {}), factorizer = new Factorizer();
    let source;
    if (workload === 'demo') {
        source = readFileSync(new URL(variant === 'recursive' ? './fixtures/397-parabola-recursive.ra'
            : '../demos/euler/397_parabola.ra', import.meta.url), 'utf8')
            .replace('arg K integer = 1000000', `arg K integer = ${limit}`);
    }
    runtime.execute('use numbers');
    const operation = runtime.execute(workload === 'sieve' ? 'factorsieve' : 'divisors');
    assert(isNativeFunction(operation));
    let answer = 0n, count = 0;
    const start = performance.now(), cpu = process.cpuUsage();
    try {
        if (workload === 'demo') {
            runtime.execute(source);
            answer = runtime.variables.get('Answer');
        } else if (workload === 'sieve') {
            operation.call([BigInt(limit)]);
        } else for (let n = 1; n <= limit; n++) {
            const value = 2n * BigInt(n) ** 2n;
            if (workload === 'factors') {
                let product = 1n;
                for (const prime of factorizer.factors(value)) { product *= prime; answer += prime; }
                assert.equal(product, value);
            } else {
                const result = operation.call([value]);
                assert(isRankSequence(result));
                for (const divisor of result.plan.iterate()) count++;
            }
        }
        const ms = performance.now() - start, usage = process.cpuUsage(cpu);
        if (workload === 'demo') {
            const checks = new Map([[1000, 63237130793050n], [10000, 1008745304821002n],
                [100000, 13388504309158360n], [1000000, 141630459461893728n]]);
            assert(checks.has(limit), 'Use a checked demo limit');
            assert.equal(answer, checks.get(limit));
        } else if (workload === 'factors') assert.equal(answer, factorChecksum);
        else if (workload === 'divisors') assert.equal(count, divisorCount);
        else {
            const result = runtime.execute(`Spf = ${limit} factorsieve\nSpf len`);
            assert.equal(result, BigInt(limit + 1));
            for (const n of [0, 1, limit]) assert.equal(runtime.execute(`Spf ${n}`), BigInt(spf[n]));
        }
        console.log(JSON.stringify({ workload, variant, limit, ms, cpuMs: (usage.user + usage.system) / 1000,
            answer: String(answer), count, maxRssKiB: process.resourceUsage().maxRSS,
            ...(source ? { sourceHash: hash(source) } : {}) }));
    } finally { runtime.dispose(); }
}
