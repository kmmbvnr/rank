// Build first. Fresh-process serial samples; diagnostics are separate runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = text => createHash('sha256').update(text).digest('hex');
const main = resolve(root, 'demos/euler/154_pascalpyramid.ra');
const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
const original = readFileSync(resolve(root, 'benchmarks/fixtures/euler154-original.ra'), 'utf8');
const sourceFor = version => version === 'pruned' ? readFileSync(main, 'utf8')
    : version === 'ready' ? original.replace("Is' =", 'Is =') : original;

// Independent digit-sum identity for factorial valuations. Enumerate ALL sorted
// triples, without the demo's outer pruning or its factorial valuation tables.
function oracle(n, power) {
    const s2 = new Int16Array(n + 1), s5 = new Int16Array(n + 1);
    for (let i = 1; i <= n; i++) {
        s2[i] = s2[Math.floor(i / 2)] + i % 2;
        s5[i] = s5[Math.floor(i / 5)] + i % 5;
    }
    const need2 = s2[n] + power, need5 = s5[n] + 4 * power;
    let answer = 0, pairs = 0, pass5 = 0;
    for (let i = 0; i <= Math.floor(n / 3); i++) {
        const needI2 = need2 - s2[i], needI5 = need5 - s5[i], m = n - i;
        for (let j = i; j <= Math.floor(m / 2); j++) {
            const k = m - j;
            pairs++;
            if (s5[j] + s5[k] < needI5) continue;
            pass5++;
            if (s2[j] + s2[k] >= needI2) answer += i === k ? 1 : i === j || j === k ? 3 : 6;
        }
    }
    return { n, power, answer, pairs, pass5 };
}

if (option('worker')) {
    const name = option('worker'), version = option('version') ?? 'pruned';
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const { readArrayItem } = await import(pathToFileURL(resolve(dirname(runtimePath), 'array-storage.js')));
    const mainSource = name === 'medium' ? sourceFor(version)
        .replace('option N integer = 200000', 'option N integer = 10000')
        .replace('option Power integer = 12', 'option Power integer = 6') : sourceFor(version);
    const output = [];
    const file = name === 'fixture' ? main.replace('.ra', '_test.ra') : main;
    const source = name === 'fixture' ? readFileSync(file, 'utf8') : mainSource;
    const d = new RuntimeDiagnostics();
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
        let candidates, pairs;
        if (name === 'fixture') {
            assert.equal(r.testResults.length, 1);
            assert(r.testResults.every(test => test.passed), JSON.stringify(r.testResults));
            assert.deepEqual(r.testResults[0].output, ['2121', '6216', '6762']);
        } else {
            const n = name === 'medium' ? 10000 : 200000, expected = name === 'medium' ? 40876875 : 479742450;
            assert.equal(r.variables.get('Answer'), BigInt(expected));
            assert.deepEqual(output, [String(expected)]);
            // Validation after the timed demand; observing a plan here is a new
            // observation and is deliberately outside the diagnostic scope too.
            const ids = r.execute('Is');
            candidates = ids.shape[0]; pairs = 0;
            for (let index = 0; index < candidates; index++) {
                const i = Number(readArrayItem(ids, index));
                pairs += Math.floor((n - i) / 2) - i + 1;
            }
        }
        console.log(JSON.stringify({ case: name, version, executeMs, peakRssMiB, candidates, pairs,
            sourceHash: hash(source), mainHash: hash(mainSource), diagnostics: option('diagnostics') ? d : undefined,
            tests: r.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })) }));
    } finally { r.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3), deadline = Number(option('deadline') ?? 120000);
    assert(Number.isSafeInteger(samples) && samples > 0);
    assert(Number.isSafeInteger(deadline) && deadline > 0);
    const versions = { ...(option('before-runtime') ? { before: resolve(option('before-runtime')), ready: resolve(option('before-runtime')) } : {}),
        compiler: runtimePath, pruned: runtimePath };
    const cases = option('cases')?.split(',') ?? ['main'];
    const jobs = Object.entries(versions).filter(([v]) => !option('versions') || option('versions').split(',').includes(v))
        .flatMap(([version, runtime]) => cases.map(name => ({ version, runtime, name })));
    assert(jobs.length > 0);
    const oracles = cases.filter(name => name !== 'fixture').map(name => name === 'medium' ? oracle(10000, 6) : oracle(200000, 12));
    for (const o of oracles) assert.equal(o.answer, o.n === 10000 ? 40876875 : 479742450);
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job.name}`, `--version=${job.version}`,
            `--runtime=${job.runtime}`, ...['engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: deadline });
        let result;
        if (child.error?.code === 'ETIMEDOUT') result = { sample, case: job.name, version: job.version, timedOut: true, deadlineMs: deadline, signal: child.signal };
        else {
            assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
            result = { sample, ...JSON.parse(child.stdout) };
        }
        results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
    }
    const runtimeHashes = Object.fromEntries(Object.entries(versions).map(([version, path]) => [version,
        Object.fromEntries(['number-loop-runtime.js', 'diagnostics.js', 'tensor-map.js', 'tensor-kernel.js', 'modules/sequences.js'].map(file => [file,
            hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples, engine: option('engine') ?? 'compiled',
        diagnostics: !!option('diagnostics'), measurements: 'serial fresh processes; parse and complete execution; peak RSS before validation',
        runtimeHashes, oracles, results }, null, 2));
}
