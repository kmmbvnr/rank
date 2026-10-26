// Build first. Serial fresh processes; diagnostics are separate from timing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = value => createHash('sha256').update(value).digest('hex');
const runtime = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
const main = resolve(root, 'demos/euler/166_crisscross.ra');
const original = readFileSync(resolve(root, 'benchmarks/fixtures/euler166-original.ra'), 'utf8');
const final = readFileSync(main, 'utf8');

if (option('worker')) {
    const name = option('worker'), version = option('version');
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtime));
    const file = name === 'fixture' ? main.replace('.ra', '_test.ra') : main;
    const mainSource = version === 'final' ? final : original;
    const source = name === 'fixture' ? readFileSync(file, 'utf8') : mainSource;
    const output = [], d = new RuntimeDiagnostics();
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
        if (name === 'fixture') {
            assert.equal(r.testResults.length, 2);
            assert(r.testResults.every(test => test.passed), JSON.stringify(r.testResults));
            assert.deepEqual(r.testResults.map(test => test.output), [['7130034'], ['34']]);
        } else {
            assert.equal(r.variables.get('Answer'), 7130034n);
            assert.deepEqual(output, ['7130034']);
        }
        console.log(JSON.stringify({ case: name, version, executeMs, peakRssMiB,
            sourceHash: hash(source), mainHash: hash(mainSource),
            diagnostics: option('diagnostics') ? d : undefined,
            tests: r.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })) }));
    } finally { r.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3), deadline = Number(option('deadline') ?? 60000);
    assert(Number.isSafeInteger(samples) && samples > 0);
    assert(Number.isSafeInteger(deadline) && deadline > 0);
    const versions = {
        ...(option('before-runtime') ? { before: resolve(option('before-runtime')) } : {}),
        ...(option('numeric-runtime') ? { numeric: resolve(option('numeric-runtime')) } : {}),
        compiler: runtime, final: runtime,
    };
    const jobs = Object.entries(versions).filter(([v]) => !option('versions') || option('versions').split(',').includes(v))
        .flatMap(([version, path]) => (option('cases')?.split(',') ?? ['main', 'fixture']).map(name => ({ version, path, name })));
    assert(jobs.length > 0);
    const results = [];
    for (let sample = 0; sample < samples; sample++) for (const job of sample % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${job.name}`, `--version=${job.version}`,
            `--runtime=${job.path}`, ...['engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
        { encoding: 'utf8', timeout: deadline });
        let result;
        if (child.error?.code === 'ETIMEDOUT') result = { sample, case: job.name, version: job.version, timedOut: true, deadlineMs: deadline };
        else {
            assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
            result = { sample, ...JSON.parse(child.stdout) };
        }
        results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
    }
    const runtimeHashes = Object.fromEntries(Object.entries(versions).map(([version, path]) => [version,
        Object.fromEntries(['collections.js', 'tensor-kernel.js', 'tensor-map.js', 'fast-paths.js', 'operators.js', 'value-selection.js',
            'eval/application-structures.js', 'eval/application.js', 'materialize.js', 'preview-values.js'].map(file => [file,
            hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples, engine: option('engine') ?? 'compiled',
        diagnostics: !!option('diagnostics'), measurements: 'serial fresh processes; parse and complete execution; peak RSS before validation',
        runtimeHashes, results }, null, 2));
}
