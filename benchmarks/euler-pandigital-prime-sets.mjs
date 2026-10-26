// Build first. Run serially, without concurrent tests:
// node benchmarks/euler-pandigital-prime-sets.mjs --baseline-runtime=/path/to/before/index.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const main = resolve(root, 'demos/euler/118_pandigitalsets.ra');
const files = { main, fixture: main.replace('.ra', '_test.ra') };
const hash = source => createHash('sha256').update(source).digest('hex');

// Independent scalar DFS and trial division; compare every mask count and DP entry.
function oracle() {
    const flags = new Uint8Array(31624), primes = [];
    for (let p = 2; p < flags.length; p++) {
        if (flags[p]) continue;
        primes.push(p);
        for (let k = p * p; k < flags.length; k += p) flags[k] = 1;
    }
    const prime = n => {
        if (n < 2) return false;
        for (const p of primes) {
            if (p * p > n) return true;
            if (n % p === 0) return false;
        }
        return true;
    };
    const counts = Array(512).fill(0), ways = Array(512).fill(0);
    const visit = (mask, n, sum, length) => {
        for (let digit = 1; digit <= 9; digit++) {
            const bit = 1 << (digit - 1);
            if (mask & bit) continue;
            const next = n * 10 + digit, m = mask | bit, s = sum + digit, k = length + 1;
            if ((k === 1 || s % 3 !== 0 && digit % 2 !== 0 && digit !== 5) && prime(next)) counts[m]++;
            visit(m, next, s, k);
        }
    };
    visit(0, 0, 0, 0);
    ways[0] = 1;
    for (let mask = 1; mask < 512; mask++) {
        const low = mask & -mask;
        for (let sub = mask; sub; sub = (sub - 1) & mask) {
            if (sub & low) ways[mask] += counts[sub] * ways[mask ^ sub];
        }
    }
    assert.equal(ways[511], 44680);
    return { counts, ways };
}

if (option('worker')) {
    const name = option('worker'), file = files[name];
    assert(file);
    const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const version = option('version') ?? 'after';
    const source = readFileSync(name === 'fixture' && version !== 'after'
        ? resolve(root, 'benchmarks/fixtures/euler118-repeated_test.ra') : file, 'utf8'), diagnostics = new RuntimeDiagnostics(), output = [];
    const runtime = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        if (option('diagnostics')) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start, peakRssMiB = process.resourceUsage().maxRSS / 1024;
        if (name === 'fixture') {
            assert.equal(runtime.testResults.length, version === 'after' ? 1 : 3);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert(runtime.testResults.every(test => test.output.join('') === '44680'));
        } else {
            const expected = oracle();
            assert.deepEqual(output, ['44680']);
            assert.equal(runtime.variables.get('Answer'), 44680n);
            assert.deepEqual(runtime.variables.get('Cnt').items.map(Number), expected.counts);
            assert.deepEqual(runtime.variables.get('Ways').items.map(Number), expected.ways);
        }
        console.log(JSON.stringify({ case: name, executeMs, peakRssMiB,
            sourceHash: hash(source), mainHash: hash(readFileSync(main)),
            diagnostics: option('diagnostics') ? diagnostics : undefined,
            tests: runtime.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const cases = option('cases')?.split(',') ?? ['main', 'fixture'];
    const runtimes = [
        ...(option('baseline-runtime') ? [['before', option('baseline-runtime')]] : []),
        ...(option('intermediate-runtime') ? [['bulk', option('intermediate-runtime')]] : []),
        ['after', option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js')],
    ];
    const selected = option('versions')?.split(',');
    const jobs = runtimes.filter(([version]) => !selected || selected.includes(version)).flatMap(([version, runtime]) => cases.map(name => ({ version, runtime, name })));
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job.name}`,
            `--runtime=${job.runtime}`, `--version=${job.version}`, ...['engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: 60000 });
        assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
        const result = { sample, version: job.version, ...JSON.parse(child.stdout) };
        results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
    }
    const runtimeHashes = Object.fromEntries(runtimes.map(([version, path]) => [version, Object.fromEntries(
        ['modules/algo.js', 'sequence.js', 'sequence-completion.js', 'prime-sequence.js', 'primality.js', 'diagnostics.js'].map(file =>
            [file, existsSync(resolve(dirname(path), file)) ? hash(readFileSync(resolve(dirname(path), file))) : null]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        engine: option('engine') ?? 'compiled', diagnostics: !!option('diagnostics'), runtimeHashes,
        measurements: 'serial fresh processes; parsing and complete execution; peak process RSS before independent oracle validation',
        results }, null, 2));
}
