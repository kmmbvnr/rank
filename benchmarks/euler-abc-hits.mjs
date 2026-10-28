// Build first. Run serially, without concurrent tests:
// node benchmarks/euler-abc-hits.mjs --samples=3
// --batched-runtime=/path/to/index.js adds the unchanged-source baseline runtime.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const main = resolve(root, 'demos/euler/127_abchits.ra');
const hash = source => createHash('sha256').update(source).digest('hex');

// Independent prime sieve, then sorted scalar enumeration. Full per-c hit
// multiplicities are checked in the separate counts workload.
function oracle(limit) {
    const radicals = new Uint32Array(limit).fill(1);
    for (let p = 2; p < limit; p++) if (radicals[p] === 1)
        for (let n = p; n < limit; n += p) radicals[n] *= p;
    const order = Array.from({ length: limit - 1 }, (_, i) => i + 1)
        .sort((a, b) => radicals[a] - radicals[b] || a - b);
    const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    const counts = new Uint32Array(limit);
    let pairs = 0, orderedPairs = 0, radicalPairs = 0, hits = 0, sum = 0;
    for (let c = 3; c < limit; c++) {
        for (const a of order) {
            if (2 * radicals[a] * radicals[c] >= c) break;
            pairs++;
            if (2 * a >= c) continue;
            orderedPairs++;
            if (radicals[a] * radicals[c - a] * radicals[c] >= c) continue;
            radicalPairs++;
            if (gcd(a, c) !== 1) continue;
            counts[c]++; hits++; sum += c;
        }
    }
    return { radicals, counts, pairs, orderedPairs, radicalPairs, hits, sum };
}

if (option('small-checks')) {
    const { Interpreter } = await import(pathToFileURL(resolve(option('runtime')
        ?? resolve(root, 'packages/interpreter/out/index.js'))));
    const sources = { batched: readFileSync(resolve(root, 'benchmarks/fixtures/euler127-batched.ra'), 'utf8'),
        pruned: readFileSync(main, 'utf8') };
    const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    const radical = n => {
        let value = 1;
        for (let p = 2; p * p <= n; p++) if (n % p === 0) {
            value *= p;
            while (n % p === 0) n /= p;
        }
        return value * (n > 1 ? n : 1);
    };
    const results = [];
    for (const limit of [3, 4, 10, 50, 100, 1000]) {
        let sum = 0, hits = 0;
        for (let c = 3; c < limit; c++) for (let a = 1; 2 * a < c; a++)
            if (gcd(a, c) === 1 && radical(a * (c - a) * c) < c) { sum += c; hits++; }
        for (const [version, source] of Object.entries(sources)) for (const compilation of [false, true]) {
            const output = [], runtime = new Interpreter(line => output.push(line), { compilation });
            try {
                runtime.execute(source.replace('arg Limit integer = 120000', `arg Limit integer = ${limit}`));
                assert.equal(runtime.variables.get('Answer'), BigInt(sum));
                assert.deepEqual(output, [String(sum)]);
                results.push({ version, compilation, limit, hits, sum });
            } finally { runtime.dispose(); }
        }
    }
    console.log(JSON.stringify({ node: process.version, sourceHashes: Object.fromEntries(
        Object.entries(sources).map(([name, source]) => [name, hash(source)])), checks: results.length, results }, null, 2));
} else if (option('worker')) {
    const name = option('worker'), version = option('version') ?? 'pruned';
    assert(['main', 'fixture', 'counts'].includes(name));
    const file = name === 'fixture' ? main.replace('.ra', '_test.ra') : main;
    const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const { readArrayItem } = await import(pathToFileURL(resolve(dirname(runtimePath), 'array-storage.js')));
    let mainSource = readFileSync(version === 'pruned' ? main
        : resolve(root, 'benchmarks/fixtures/euler127-batched.ra'), 'utf8');
    if (name === 'counts' && version === 'pruned') mainSource = mainSource
        .replace('Answer = 0', 'Counts = array shape Limit fill 0\nAnswer = 0')
        .replace('Answer += C', 'Answer += C\n      Counts C += 1');
    const source = name === 'fixture' ? readFileSync(file, 'utf8') : mainSource;
    const d = new RuntimeDiagnostics(), output = [];
    const runtime = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: id === main ? mainSource : readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        if (option('diagnostics')) d.run(() => runtime.execute(source));
        else runtime.execute(source);
        const executeMs = performance.now() - start, peakRssMiB = process.resourceUsage().maxRSS / 1024;
        let expected;
        if (name === 'fixture') {
            assert.equal(runtime.testResults.length, 4);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert.deepEqual(runtime.testResults.map(test => test.output), [['18407904'], ['12523'], ['0'], ['9']]);
        } else {
            expected = oracle(120000);
            assert.equal(expected.sum, 18407904);
            assert.equal(runtime.variables.get('Answer'), BigInt(expected.sum));
            assert.deepEqual(output, ['18407904']);
            const rad = runtime.variables.get('Rad');
            for (let i = 0; i < expected.radicals.length; i++)
                assert.equal(readArrayItem(rad, i), BigInt(expected.radicals[i]));
            if (name === 'counts') {
                const counts = new Uint32Array(120000);
                if (version === 'pruned') {
                    const actual = runtime.variables.get('Counts');
                    for (let c = 0; c < counts.length; c++) counts[c] = Number(readArrayItem(actual, c));
                } else {
                    const mask = runtime.variables.get('Hit'), cs = runtime.variables.get('Cc');
                    for (let i = 0; i < mask.shape[0]; i++) if (readArrayItem(mask, i)) counts[Number(readArrayItem(cs, i))]++;
                }
                assert.deepEqual(counts, expected.counts);
            }
        }
        console.log(JSON.stringify({ case: name, version, executeMs, peakRssMiB,
            sourceHash: hash(source), mainHash: hash(mainSource),
            oracle: expected && { pairs: expected.pairs, orderedPairs: expected.orderedPairs,
                radicalPairs: expected.radicalPairs, hits: expected.hits, sum: expected.sum },
            diagnostics: option('diagnostics') ? d : undefined,
            tests: runtime.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const runtime = option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js');
    const versions = { ...(option('batched-runtime') ? { batched: option('batched-runtime') } : {}),
        compiler: runtime, pruned: runtime };
    const cases = option('cases')?.split(',') ?? ['main', 'fixture'];
    const jobs = Object.entries(versions).filter(([v]) => !option('versions') || option('versions').split(',').includes(v))
        .flatMap(([version, runtime]) => cases.map(name => ({ version, runtime, name })));
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job.name}`,
            `--runtime=${job.runtime}`, `--version=${job.version}`,
            ...['engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: 120000 });
        assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
        const result = { sample, ...JSON.parse(child.stdout) };
        results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
    }
    const runtimeHashes = Object.fromEntries(Object.entries(versions).map(([version, path]) => [version,
        Object.fromEntries(['rank-application.js', 'tensor-map.js', 'tensor-kernel.js', 'integer-array-kernel.js',
            'integer-loop.js', 'selectors.js'].map(file => [file, hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        engine: option('engine') ?? 'compiled', diagnostics: !!option('diagnostics'), runtimeHashes,
        measurements: 'serial fresh processes; parsing and complete execution; peak RSS before oracle validation', results }, null, 2));
}
