// Build first. Run serially, without concurrent tests:
// node benchmarks/euler-palindromic-sums.mjs --samples=3
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const main = resolve(root, 'demos/euler/125_palindromicsums.ra');
const files = { main, fixture: main.replace('.ra', '_test.ra') };
const hash = source => createHash('sha256').update(source).digest('hex');

// Independent rectangular prefix-sum enumeration and decimal text comparison.
// The selected Rank program instead accumulates each run and reverses digits.
function oracle() {
    const limit = 100000000, top = Math.floor(Math.sqrt(limit));
    const prefix = new Float64Array(top + 1);
    for (let i = 1; i <= top; i++) prefix[i] = prefix[i - 1] + i * i;
    let most = 0;
    while (prefix[most] < limit) most++;
    const candidates = new Set();
    let validRuns = 0;
    for (let start = 0; start < top; start++) for (let length = 2; length <= most; length++) {
        const end = start + length;
        if (end > top) continue;
        const value = prefix[end] - prefix[start];
        if (value < limit) { validRuns++; candidates.add(value); }
    }
    const palindromes = [...candidates].filter(n => {
        const text = String(n);
        return text === [...text].reverse().join('');
    }).sort((a, b) => a - b);
    assert.equal(palindromes.reduce((a, b) => a + b, 0), 2906969179);
    assert.equal(palindromes.length, 166);
    return { candidates: [...candidates].sort((a, b) => a - b), palindromes,
        top, most, cells: top * (most - 1), validRuns };
}

if (option('worker')) {
    const name = option('worker'), file = files[name];
    assert(file);
    const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const version = option('version') ?? 'after';
    const mainSource = readFileSync(version === 'before'
        ? resolve(root, 'benchmarks/fixtures/euler125-completed-end.ra') : main, 'utf8');
    const source = name === 'main' ? mainSource : readFileSync(file, 'utf8');
    const diagnostics = new RuntimeDiagnostics(), output = [];
    const runtime = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: id === main ? mainSource : readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        if (option('diagnostics')) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start, peakRssMiB = process.resourceUsage().maxRSS / 1024;
        if (name === 'fixture') {
            assert.equal(runtime.testResults.length, 4);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert.deepEqual(runtime.testResults.map(test => test.output), [['2906969179'], ['4164'], ['0'], ['5']]);
        } else {
            const expected = oracle();
            assert.deepEqual(output, ['2906969179']);
            assert.equal(runtime.variables.get('Answer'), 2906969179n);
            if (version === 'before') {
                assert.deepEqual(runtime.variables.get('Cand').items.map(Number).sort((a, b) => a - b), expected.candidates);
            } else {
                const actual = [...runtime.variables.get('Seen').entries.values()].map(Number).sort((a, b) => a - b);
                assert.deepEqual(actual, expected.palindromes);
            }
        }
        console.log(JSON.stringify({ case: name, executeMs, peakRssMiB,
            sourceHash: hash(source), mainHash: hash(mainSource),
            diagnostics: option('diagnostics') ? diagnostics : undefined,
            tests: runtime.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const cases = option('cases')?.split(',') ?? ['main', 'fixture'];
    const runtimePath = option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js');
    const runtimes = (option('versions')?.split(',') ?? ['before', 'after']).map(version => [version, runtimePath]);
    const jobs = runtimes.flatMap(([version, runtime]) => cases.map(name => ({ version, runtime, name })));
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
        ['integer-loop.js', 'scalar-function-proof.js', 'operators.js', 'modules/sequences.js'].map(file =>
            [file, hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        engine: option('engine') ?? 'compiled', diagnostics: !!option('diagnostics'), runtimeHashes,
        measurements: 'serial fresh processes; parsing and complete execution; peak process RSS before independent oracle validation',
        results }, null, 2));
}
