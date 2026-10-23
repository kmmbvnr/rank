// Build first. Each sample gets a fresh process; execute includes parsing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const cases = [
    { name: 'small', n: 10000, expected: 117645084n },
    { name: 'million', n: 1000000, expected: 1176221685648n },
    { name: 'full', n: 100000000, expected: 11762187201804552n },
];

// Independent host recurrence: integer-valued sieve cells stay below 2^53;
// the summatory recurrence and final result use arbitrary-precision integers.
function oracle(n) {
    const root = Math.floor(Math.sqrt(n)), phi = Float64Array.from({ length: root + 1 }, (_, i) => i);
    for (let p = 2; p <= root; p++) if (phi[p] === p) for (let v = p; v <= root; v += p) phi[v] -= phi[v] / p;
    for (let i = 1; i <= root; i++) phi[i] += phi[i - 1];
    const cache = new Map();
    function sum(x) {
        if (x <= root) return BigInt(phi[x]);
        if (cache.has(x)) return cache.get(x);
        let total = BigInt(x) * BigInt(x + 1) / 2n;
        for (let l = 2; l <= x;) {
            const q = Math.floor(x / l), r = Math.floor(x / q);
            total -= BigInt(r - l + 1) * sum(q);
            l = r + 1;
        }
        cache.set(x, total);
        return total;
    }
    return 6n * (BigInt(n) * BigInt(n + 1) / 2n - sum(n));
}

if (option('worker')) {
    const entry = cases.find(entry => entry.name === option('worker'));
    assert.ok(entry, 'unknown benchmark case');
    const runtime = option('runtime') ? pathToFileURL(option('runtime')) : new URL('../packages/interpreter/out/index.js', import.meta.url);
    const { Interpreter } = await import(runtime.href);
    const source = readFileSync(new URL('../demos/euler/351_orchards.ra', import.meta.url), 'utf8');
    const interpreter = new Interpreter(() => {}, { args: [`--limit=${entry.n}`] });
    const start = performance.now();
    try {
        interpreter.execute(source);
        const executeMs = performance.now() - start;
        assert.equal(interpreter.variables.get('Answer'), entry.expected);
        console.log(JSON.stringify({ case: entry.name, executeMs, result: String(entry.expected) }));
    } finally { interpreter.dispose(); }
} else {
    const trials = Number(option('trials') ?? 3), timeout = Number(option('timeout-ms') ?? 90000);
    assert.ok(Number.isSafeInteger(trials) && trials > 0);
    assert.ok(Number.isSafeInteger(timeout) && timeout > 0);
    const names = (option('cases') ?? 'million,full').split(',');
    assert.ok(names.every(name => cases.some(entry => entry.name === name)), 'unknown benchmark case');
    const variants = [...(option('baseline') ? [['baseline', option('baseline')]] : []),
        ...(option('phase1') ? [['recursive-semantic-arrays', option('phase1')]] : []), ['candidate', undefined]];
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, trials,
        timings: 'fresh sequential processes; execute includes parsing; answers checked on every sample' }));
    for (const entry of cases.filter(entry => names.includes(entry.name))) {
        assert.equal(oracle(entry.n), entry.expected);
        const samples = new Map(variants.map(([variant]) => [variant, []]));
        for (let trial = 1; trial <= trials; trial++) for (const [variant, runtime] of variants) {
            const start = performance.now();
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`,
                ...(runtime ? [`--runtime=${runtime}`] : [])], { encoding: 'utf8', timeout });
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            const sample = { ...JSON.parse(child.stdout), variant, trial, processMs: performance.now() - start };
            samples.get(variant).push(sample.executeMs);
            console.log(JSON.stringify(sample));
        }
        for (const [variant, times] of samples) {
            times.sort((a, b) => a - b);
            console.log(JSON.stringify({ case: entry.name, variant, medianExecuteMs: times[Math.floor(times.length / 2)] }));
        }
    }
}
