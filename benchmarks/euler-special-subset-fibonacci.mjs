// Build first. Run serially, without concurrent tests:
// node benchmarks/euler-special-subset-fibonacci.mjs --baseline-runtime=/path/to/before/index.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const filenames = { 103: '103_specialsubset', 104: '104_pandigitalfib' };
const hash = source => createHash('sha256').update(source).digest('hex');
const read = file => readFileSync(resolve(root, file), 'utf8');

function validate(runtime, id) {
    if (id === '103') {
        const found = runtime.variables.get('Found').items;
        assert.equal(found.join(''), '20313839404245');
        assert.equal(runtime.variables.get('Best'), 255n);
        // Independent verification of both special-sum conditions.
        const sums = new Set();
        for (let mask = 0; mask < 128; mask++) {
            const sum = found.reduce((total, value, i) => total + (mask & (1 << i) ? value : 0n), 0n);
            assert(!sums.has(sum)); sums.add(sum);
        }
        for (let k = 1; k <= 3; k++) {
            assert(found.slice(0, k + 1).reduce((a, b) => a + b, 0n)
                > found.slice(-k).reduce((a, b) => a + b, 0n));
        }
    } else {
        const tails = runtime.variables.get('Tail').items;
        const candidates = [], pandigital = value => String(value).split('').sort().join('') === '123456789';
        let a = 1, b = 1, answer;
        for (let n = 1; n <= 400000; n++) {
            let tail = 1;
            if (n > 2) { tail = (a + b) % 1e9; a = b; b = tail; }
            assert.equal(tails[n], BigInt(tail), `tail at ${n}`);
            if (!pandigital(tail)) continue;
            candidates.push(BigInt(n));
            const spin = n * Math.log10((1 + Math.sqrt(5)) / 2) - Math.log10(5) / 2;
            if (answer === undefined && pandigital(Math.floor(10 ** (spin - Math.floor(spin) + 8)))) answer = n;
        }
        assert.deepEqual(runtime.variables.get('Cands').items, candidates);
        assert.equal(answer, 329468);
        assert.equal(runtime.variables.get('Answer'), BigInt(answer));
    }
}

if (option('worker')) {
    const [id, version, kind] = option('worker').split(':');
    assert(filenames[id]);
    const original = version === 'before' || version === 'compiler';
    const oldFixture = version !== 'after';
    const main = resolve(root, 'demos/euler', filenames[id] + '.ra');
    const fixture = main.replace('.ra', '_test.ra');
    const mainSource = id === '104' && original ? read('benchmarks/fixtures/euler104-axis.ra') : read(main);
    const source = kind === 'main' ? mainSource : oldFixture
        ? read(`benchmarks/fixtures/euler${id}-repeated_test.ra`) : read(fixture);
    const runtimePath = resolve(version === 'before' ? option('baseline-runtime') : option('runtime')
        ?? resolve(root, 'packages/interpreter/out/index.js'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const diagnostics = new RuntimeDiagnostics(), output = [];
    const runtime = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId: kind === 'main' ? main : fixture,
        loadModule(specifier, from) {
            const path = resolve(dirname(from ?? fixture), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id: path, source: path === main ? mainSource : read(path) };
        },
    });
    try {
        const start = performance.now();
        if (option('diagnostics')) diagnostics.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start, peakRssMiB = process.resourceUsage().maxRSS / 1024;
        if (kind === 'main') {
            assert.deepEqual(output, [id === '103' ? '20313839404245' : '329468']);
            validate(runtime, id);
        } else {
            assert.equal(runtime.testResults.length, id === '103' ? oldFixture ? 2 : 1 : oldFixture ? 4 : 2);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
        }
        console.log(JSON.stringify({ id, version, kind, executeMs, peakRssMiB,
            mainHash: hash(mainSource), workloadHash: hash(source),
            diagnostics: option('diagnostics') ? diagnostics : undefined,
            tests: runtime.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const ids = option('ids')?.split(',') ?? ['103', '104'];
    const kinds = option('cases')?.split(',') ?? ['main', 'fixture'];
    const jobs = ids.flatMap(id => (option('versions')?.split(',') ?? (option('baseline-runtime')
        ? id === '103' ? ['before', 'after'] : ['before', 'compiler', 'rank', 'after'] : ['after']))
        .flatMap(version => kinds.map(kind => `${id}:${version}:${kind}`)));
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job}`,
            ...['baseline-runtime', 'runtime', 'engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: 60000 });
        assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
        const result = { sample, ...JSON.parse(child.stdout) };
        results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
    }
    const runtimeHashes = Object.fromEntries([
        ['current', option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js')],
        ...(option('baseline-runtime') ? [['before', option('baseline-runtime')]] : []),
    ].map(([version, path]) => [version, Object.fromEntries(
        ['reduction.js', 'tensor-map.js', 'tensor-kernel.js', 'diagnostics.js', 'operators.js', 'value-comparison.js'].map(file =>
            [file, hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, runtimeHashes,
        baselineRuntime: option('baseline-runtime'), samples, engine: option('engine') ?? 'compiled',
        diagnostics: !!option('diagnostics'),
        measurements: 'serial fresh processes; parsing and complete execution; peak process RSS before independent oracle validation',
        results }, null, 2));
}
