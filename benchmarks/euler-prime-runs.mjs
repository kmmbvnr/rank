// Build first. Run serially, without concurrent tests:
// node benchmarks/euler-prime-runs.mjs --baseline-runtime=/path/to/before/index.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const main = resolve(root, 'demos/euler/111_primerunning.ra');
const files = { main, fixture: main.replace('.ra', '_test.ra') };
const hash = source => createHash('sha256').update(source).digest('hex');

// Independent scalar generator and trial division through sqrt(10^10).
// The Rank program uses tensor contraction and sequence membership instead.
function oracle(size) {
    const composite = new Uint8Array(100001), primes = [];
    for (let n = 2; n <= 100000; n++) {
        if (composite[n]) continue;
        primes.push(n);
        for (let k = n * n; k <= 100000; k += n) composite[k] = 1;
    }
    const prime = n => {
        if (n < 2) return false;
        for (const p of primes) {
            if (p * p > n) return true;
            if (n % p === 0) return false;
        }
        return true;
    };
    const found = new Set(), rows = [], low = 10 ** (size - 1), ones = (10 ** size - 1) / 9;
    for (let free = 1; free < size && found.size < 10; free++) {
        const positions = [];
        const choose = (prefix, start) => {
            if (prefix.length === free) { positions.push(prefix); return; }
            for (let p = start; p < size; p++) choose([...prefix, p], p + 1);
        };
        choose([], 0);
        for (let digit = 0; digit < 10; digit++) {
            const accepted = [];
            for (const set of positions) for (let code = 0; code < 9 ** free; code++) {
                let n = digit * ones, k = code;
                for (const p of set) {
                    const x = k % 9; k = Math.floor(k / 9);
                    n += ((x >= digit ? x + 1 : x) - digit) * 10 ** p;
                }
                if (n >= low && prime(n)) accepted.push(n);
            }
            if (accepted.length && !found.has(digit)) {
                found.add(digit);
                rows.push({ digit, repeats: size - free, count: accepted.length,
                    sum: accepted.reduce((a, b) => a + b, 0) });
            }
        }
    }
    return { answer: rows.reduce((a, b) => a + b.sum, 0), rows };
}

if (option('worker')) {
    const name = option('worker'), file = files[name];
    assert(file);
    const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const source = readFileSync(file, 'utf8'), diagnostics = new RuntimeDiagnostics(), output = [];
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
            assert.equal(runtime.testResults.length, 2);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert.deepEqual(runtime.testResults.map(test => test.output), [['612407567715'], ['273700']]);
        } else {
            const expected = oracle(10);
            assert.equal(expected.answer, 612407567715);
            assert.deepEqual(output, [String(expected.answer)]);
            assert.equal(runtime.variables.get('Answer'), BigInt(expected.answer));
            assert.deepEqual(runtime.variables.get('Found').items, Array(10).fill(true));
            assert.equal(oracle(4).answer, 273700);
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
        ['after', option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js')],
    ];
    const jobs = runtimes.flatMap(([version, runtime]) => cases.map(name => ({ version, runtime, name })));
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job.name}`,
            `--runtime=${job.runtime}`, ...['engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: 60000 });
        assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
        const result = { sample, version: job.version, ...JSON.parse(child.stdout) };
        results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
    }
    const runtimeHashes = Object.fromEntries(runtimes.map(([version, path]) => [version, Object.fromEntries(
        ['array-read.js', 'derived-array.js', 'tensor.js', 'scalar-array-map.js'].map(file =>
            [file, hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        engine: option('engine') ?? 'compiled', diagnostics: !!option('diagnostics'), runtimeHashes,
        measurements: 'serial fresh processes; parsing and complete execution; peak process RSS before independent oracle validation',
        results }, null, 2));
}
