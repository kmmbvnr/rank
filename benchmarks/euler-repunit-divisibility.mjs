// Build first. Serial fresh processes; diagnostics are separate from timings.
// node benchmarks/euler-repunit-divisibility.mjs --samples=3 --before-runtime=/path/to/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const main = resolve(root, 'demos/euler/129_repunitdiv.ra');
const hash = text => createHash('sha256').update(text).digest('hex');
const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
function factors(n) {
    const result = [];
    for (let p = 2; p * p <= n; p++) if (n % p === 0) {
        result.push(p);
        while (n % p === 0) n /= p;
    }
    if (n > 1) result.push(n);
    return result;
}
function power(base, exponent, modulus) {
    let value = 1n;
    while (exponent) {
        if (exponent % 2) value = value * base % modulus;
        base = base * base % modulus;
        exponent = Math.floor(exponent / 2);
    }
    return value;
}
// Independent multiplicative order modulo 9n, rather than repunit iteration.
function oracle(limit, window = 30) {
    const orders = [];
    for (let n = limit + 1; n <= limit + window; n++) {
        if (n % 2 === 0 || n % 5 === 0) continue;
        const modulus = 9 * n;
        let phi = modulus;
        for (const p of factors(modulus)) phi = phi / p * (p - 1);
        let k = phi;
        for (const p of factors(phi)) while (k % p === 0 && power(10n, k / p, BigInt(modulus)) === 1n) k /= p;
        orders.push({ n, k });
    }
    return { answer: orders.find(({ k }) => k > limit)?.n, orders };
}
const sourceFor = version => version === 'pruned' ? readFileSync(main, 'utf8')
    : readFileSync(resolve(root, 'benchmarks/fixtures/euler129-batched.ra'), 'utf8')
        .replace('(concat Tab Next axis 1) copy', version.endsWith('nocopy') ? 'concat Tab Next axis 1' : '(concat Tab Next axis 1) copy');

if (option('worker')) {
    const name = option('worker'), version = option('version') ?? 'pruned';
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const { readArrayItem } = await import(pathToFileURL(resolve(dirname(runtimePath), 'array-storage.js')));
    const mainSource = sourceFor(version);
    const file = name === 'fixture' ? main.replace('.ra', '_test.ra') : main;
    const source = name === 'fixture' ? readFileSync(file, 'utf8') : mainSource;
    const d = new RuntimeDiagnostics(), output = [];
    const r = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: id === main ? mainSource : readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        if (option('diagnostics')) d.run(() => r.execute(source)); else r.execute(source);
        const executeMs = performance.now() - start, peakRssMiB = process.resourceUsage().maxRSS / 1024;
        let expected;
        if (name === 'fixture') {
            assert.equal(r.testResults.length, 4);
            assert(r.testResults.every(test => test.passed), JSON.stringify(r.testResults));
            assert.deepEqual(r.testResults.map(test => test.output), [['1000023'], ['17'], ['7'], ['17']]);
        } else {
            expected = oracle(1000000);
            assert.equal(expected.answer, 1000023);
            assert.equal(expected.orders.find(({ n }) => n === expected.answer).k, 1000020);
            assert.equal(r.variables.get('Answer'), BigInt(expected.answer));
            assert.deepEqual(output, [String(expected.answer)]);
            if (version !== 'pruned') {
                const ns = expected.orders.map(({ n }) => n), table = r.variables.get('Tab');
                assert.deepEqual(table.shape, [12, 1048576]);
                for (let row = 0; row < ns.length; row++) for (const col of [0, 1, 9, 99, 999999, 1048575])
                    assert.equal(readArrayItem(table, row * table.shape[1] + col), power(10n, col + 1, 9n * BigInt(ns[row])));
            }
        }
        console.log(JSON.stringify({ case: name, version, executeMs, peakRssMiB, sourceHash: hash(source), mainHash: hash(mainSource),
            oracle: expected, diagnostics: option('diagnostics') ? d : undefined,
            tests: r.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })) }));
    } finally { r.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const versions = { ...(option('before-runtime') ? { before: resolve(option('before-runtime')), 'before-nocopy': resolve(option('before-runtime')) } : {}),
        compiler: runtimePath, nocopy: runtimePath, pruned: runtimePath };
    const cases = option('cases')?.split(',') ?? ['main'];
    const jobs = Object.entries(versions).filter(([v]) => !option('versions') || option('versions').split(',').includes(v))
        .flatMap(([version, runtime]) => cases.map(name => ({ version, runtime, name })));
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job.name}`,
            `--version=${job.version}`, `--runtime=${job.runtime}`,
            ...['engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: 120000 });
        assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
        const result = { sample, ...JSON.parse(child.stdout) };
        results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
    }
    const runtimeHashes = Object.fromEntries(Object.entries(versions).map(([version, path]) => [version,
        Object.fromEntries(['tensor-map.js', 'tensor-kernel.js', 'modules/sequences.js'].map(file => [file,
            hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples, engine: option('engine') ?? 'compiled',
        diagnostics: !!option('diagnostics'), measurements: 'serial fresh processes; parse and complete execution; peak RSS before oracle validation',
        runtimeHashes, results }, null, 2));
}
