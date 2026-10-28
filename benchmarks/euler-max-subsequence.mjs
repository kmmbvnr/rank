// Build first. Run serially: node benchmarks/euler-max-subsequence.mjs --samples=3
// Optional immutable runtime snapshots: --before=/path/out/index.js --concat=/path/out/index.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const main = resolve(root, 'demos/euler/149_maxsubsequence.ra');
const hash = text => createHash('sha256').update(text).digest('hex');

// Independent scalar Kadane walks, with no padding, skewing or prefix arrays.
function oracle(n) {
    const s = new Float64Array(Math.max(55, n * n));
    for (let k = 1; k <= 55; k++) s[k - 1] = (100003 - 200003 * k + 300007 * k ** 3) % 1000000 - 500000;
    for (let k = 56; k <= s.length; k++) s[k - 1] = (s[k - 25] + s[k - 56] + 1000000) % 1000000 - 500000;
    const bests = [];
    for (const [dr, dc] of [[0, 1], [1, 0], [1, -1], [1, 1]]) {
        let best = -Infinity;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
            if (r - dr >= 0 && r - dr < n && c - dc >= 0 && c - dc < n) continue;
            let sum = 0;
            for (let y = r, x = c; y >= 0 && y < n && x >= 0 && x < n; y += dr, x += dc) {
                const cell = s[y * n + x];
                sum = Math.max(cell, sum + cell);
                best = Math.max(best, sum);
            }
        }
        bests.push(best);
    }
    return bests;
}

if (option('worker')) {
    const runtimePath = resolve(option('runtime'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const n = Number(option('size') ?? 2000);
    assert(Number.isSafeInteger(n) && n > 0);
    const fixture = option('worker') === 'fixture';
    assert(!fixture || n === 2000, 'the fixture retains the full default input');
    const file = fixture ? main.replace('.ra', '_test.ra') : main;
    const mainSource = readFileSync(main, 'utf8').replace('arg N integer = 2000', `arg N integer = ${n}`);
    const source = fixture ? readFileSync(file, 'utf8') : mainSource;
    const output = [], diagnostics = new RuntimeDiagnostics();
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
        const executeMs = performance.now() - start;
        const peakRssMiB = process.resourceUsage().maxRSS / 1024;
        if (fixture) {
            assert.equal(runtime.testResults.length, 3);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert.deepEqual(runtime.testResults.map(test => test.output), [['52852124'], ['8642499'], ['1722603', '6047365']]);
        } else {
            const bests = oracle(n);
            for (const [i, name] of ['Rows', 'Cols', 'Down', 'Up'].entries()) {
                assert.equal(runtime.variables.get(name), BigInt(bests[i]), name);
            }
            const answer = BigInt(Math.max(...bests));
            assert.equal(runtime.variables.get('Answer'), answer);
            assert.deepEqual(output, [String(answer)]);
        }
        console.log(JSON.stringify({ n, workload: option('worker'), executeMs, peakRssMiB,
            sourceHash: hash(source), mainHash: hash(mainSource),
            diagnostics: option('diagnostics') ? diagnostics : undefined,
            tests: runtime.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const versions = option('versions')?.split(',') ?? ['before', 'concat', 'after'].filter(name => name === 'after' || option(name));
    for (const version of versions) assert(version === 'after' || option(version), `--${version}=runtime-path is required`);
    const runtimes = Object.fromEntries(versions.map(version => [version,
        resolve(option(version) ?? 'packages/interpreter/out/index.js')]));
    const jobs = versions.flatMap(version => (option('cases')?.split(',') ?? ['main', 'fixture'])
        .map(workload => ({ version, workload })));
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job.workload}`,
            `--runtime=${runtimes[job.version]}`, ...['engine', 'size', 'diagnostics'].flatMap(name =>
                option(name) ? [`--${name}=${option(name)}`] : [])], { encoding: 'utf8', timeout: 120000 });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr || child.stdout);
        const result = { sample, version: job.version, ...JSON.parse(child.stdout) };
        results.push(result);
        process.stderr.write(JSON.stringify(result) + '\n');
    }
    const runtimeHashes = Object.fromEntries(Object.entries(runtimes).map(([version, path]) => [version,
        Object.fromEntries(['modules/sequences.js', 'tensor-map.js', 'tensor-kernel.js', 'reduction.js'].map(file =>
            [file, hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        engine: option('engine') ?? 'compiled', diagnostics: !!option('diagnostics'), runtimeHashes,
        measurements: 'serial fresh processes; parsing and complete execution; peak process RSS before oracle validation', results }, null, 2));
}
