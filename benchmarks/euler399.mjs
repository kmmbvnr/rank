// Focused Euler 399 benchmark. Build first; performance runs are not CI gates.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const checkout = resolve(option('checkout') ?? new URL('..', import.meta.url).pathname);
const primeLimit = Number(option('prime-limit') ?? 5714285);
const limit = Number(option('limit') ?? 200000000);
const count = Number(option('count') ?? 100000000);
const stage = option('stage') ?? 'moduli';
assert.ok(['moduli', 'full', 'fibmod', 'selection'].includes(stage));
const variant = option('variant') ?? 'current';
assert.ok(['current', 'powers'].includes(variant));
for (const value of [primeLimit, limit, count]) assert.ok(Number.isSafeInteger(value) && value > 0);

if (process.argv.includes('--worker')) {
    const { Interpreter } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    let source = readFileSync(resolve(checkout, 'demos/euler/399_squarefree.ra'), 'utf8')
        .replace('arg PrimeLimit integer = 5714285', `arg PrimeLimit integer = ${primeLimit}`)
        .replace('arg Limit integer = 200000000', `arg Limit integer = ${limit}`)
        .replace('arg Count integer = 100000000', `arg Count integer = ${count}`);
    if (variant === 'powers') source = source.replace('A * A + B * B', 'A ** 2 + B ** 2');
    const helper = source.slice(source.indexOf('rem Fast doubling'));
    let compiledCalls = 0;
    const runtime = new Interpreter(() => {}, { onScalarFunctionExecuted: () => compiledCalls++ });
    const phases = [];
    let verification;
    const run = (name, text) => {
        const cpu = process.cpuUsage(), start = performance.now();
        runtime.execute(text);
        const usage = process.cpuUsage(cpu);
        phases.push({ name, executeMs: performance.now() - start, cpuMs: (usage.user + usage.system) / 1000 });
        console.error(JSON.stringify(phases.at(-1)));
    };
    try {
        if (stage === 'fibmod') {
            runtime.execute(`use numbers\nuse bits\n${helper}`);
            const program = 'Answer = 0\nfor P in 2 till 10002\n Answer += 12345 fibmod P\nend';
            run('fibmod-10000', program);
            assert.equal(runtime.variables.get('Answer'), 24604978n);
        } else {
            const selection = source.indexOf('rem Find the Count-th');
            const inclusion = source.indexOf('rem Group inclusion-exclusion');
            const preparationEnd = inclusion < 0 ? selection : inclusion;
            if (stage === 'selection') {
                const start = performance.now();
                const reference = referenceModuli(primeLimit, limit);
                console.error(JSON.stringify({ name: 'reference-setup', executeMs: performance.now() - start }));
                runtime.execute(source.slice(0, source.indexOf('rem Wall gives')) + '\n' + helper);
                runtime.variables.set('Mods', { kind: 'array', shape: [reference.moduli.length], items: reference.moduli.map(BigInt) });
            } else run('moduli', helper + '\n' + source.slice(0, preparationEnd));
            runtime.execute('ModCount = Mods len');
            if (process.argv.includes('--verify')) {
                const start = performance.now();
                const reference = referenceModuli(primeLimit, limit);
                assert.deepEqual(runtime.variables.get('Mods').items.map(Number), reference.moduli);
                verification = { ...reference, moduli: reference.moduli.length, executeMs: performance.now() - start };
            }
            if (stage === 'full' || stage === 'selection') {
                if (inclusion >= 0) run('inclusion-exclusion', source.slice(inclusion, selection));
                run('selection-and-format', source.slice(selection, source.indexOf('rem Fast doubling')));
                if (count === 200 && limit === 300 && primeLimit === 53) {
                    assert.equal(runtime.variables.get('Index'), 260n);
                    assert.equal(runtime.variables.get('Answer'), '1608739584170445,9.7e53');
                }
                if (count === 100000000 && limit === 200000000 && primeLimit === 5714285) {
                    assert.equal(runtime.variables.get('Index'), 130775524n);
                    assert.equal(runtime.variables.get('Answer'), '1508395636674243,6.5e27330467');
                }
            }
        }
        console.log(JSON.stringify({ phases, compiledCalls, verification, modCount: String(runtime.variables.get('ModCount') ?? ''),
            index: String(runtime.variables.get('Index') ?? ''), answer: String(runtime.variables.get('Answer') ?? ''),
            maxRssKiB: process.resourceUsage().maxRSS }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), timeout = Number(option('timeout') ?? 30000);
    assert.ok(Number.isInteger(trials) && trials > 0 && Number.isInteger(timeout) && timeout > 0);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, checkout, primeLimit, limit, count, stage, variant,
        timing: 'fresh sequential processes; execute includes parsing; process includes startup' }));
    for (let trial = 0; trial < trials; trial++) {
        const start = performance.now();
        const child = spawnSync(process.execPath, [import.meta.filename, ...process.argv.slice(2), '--worker'],
            { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
        if (child.error?.code === 'ETIMEDOUT') {
            console.log(JSON.stringify({ trial, status: 'timeout', processMs: performance.now() - start, completedPhases: child.stderr.trim() }));
            process.exitCode = 1;
            continue;
        }
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        console.log(JSON.stringify({ trial, processMs: performance.now() - start, ...JSON.parse(child.stdout) }));
    }
}

// Independent bounded Number oracle: one complete SPF table and no Rank calls.
// The bound covers both products in doubling, so all integer arithmetic is exact.
function referenceModuli(bound, limit) {
    assert.ok(2 * bound * bound < 2 ** 53);
    const smallest = new Uint32Array(bound + 2);
    for (let p = 2; p < smallest.length; p++) {
        if (smallest[p]) continue;
        smallest[p] = p;
        for (let m = p * p; m < smallest.length; m += p) if (!smallest[m]) smallest[m] = p;
    }
    const fib = (n, modulus) => {
        let a = 0, b = 1;
        for (const bit of n.toString(2)) {
            const c = ((a * (2 * b - a)) % modulus + modulus) % modulus;
            const d = (a * a + b * b) % modulus;
            [a, b] = bit === '0' ? [c, d] : [d, (c + d) % modulus];
        }
        return a;
    };
    const moduli = [];
    let primes = 0, queries = 0, candidates = 0;
    for (let p = 2; p <= bound; p++) {
        if (smallest[p] !== p) continue;
        primes++;
        let rank = p === 2 ? 3 : p === 5 ? 5 : p + ([1, 4].includes(p % 5) ? -1 : 1);
        if (p !== 2 && p !== 5) {
            let remaining = rank;
            while (remaining > 1) {
                const q = smallest[remaining];
                while (remaining % q === 0) remaining /= q;
                while (rank % q === 0) {
                    queries++;
                    if (fib(rank / q, p) !== 0) break;
                    rank /= q;
                }
            }
        }
        const modulus = p * rank;
        if (modulus > limit) continue;
        candidates++;
        if (!moduli.some(old => modulus % old === 0)) moduli.push(modulus);
    }
    return { moduli, primes, queries, candidates };
}
