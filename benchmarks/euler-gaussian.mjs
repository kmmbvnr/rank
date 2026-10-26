// Build first. Fresh processes, serial alternating baseline/candidate samples.
// node benchmarks/euler-gaussian.mjs --before-runtime=/path/to/out/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const main = resolve(root, 'demos/euler/153_gaussian.ra');
const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
const hash = text => createHash('sha256').update(text).digest('hex');
const files = { main, fixture: main.replace('.ra', '_test.ra') };
const controls = {
    'scalar-writes': 'use sequences\nuse io\nA = array shape 10000 fill 0\nfor I in 1 to 100000\n A (I mod 10000) += 1\nend\nAnswer = A sum\nAnswer print',
    'scalar-loop': 'use io\nAnswer = 0\nfor I in 1 to 100000\n Answer += I mod 7 * 3 + 1\nend\nAnswer print',
};

if (option('worker')) {
    const name = option('worker'), file = files[name] ?? main;
    const source = controls[name] ?? readFileSync(file, 'utf8');
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const output = [], diagnostics = new RuntimeDiagnostics();
    const r = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        if (option('diagnostics')) diagnostics.run(() => r.execute(source)); else r.execute(source);
        const executeMs = performance.now() - start, peakRssMiB = process.resourceUsage().maxRSS / 1024;
        if (name === 'fixture') {
            assert.equal(r.testResults.length, 2);
            assert(r.testResults.every(test => test.passed), JSON.stringify(r.testResults));
            assert.deepEqual(r.testResults.map(test => test.output), [['17971254122360635'], ['35', '17924657155']]);
        } else {
            const expected = name === 'scalar-writes' ? 100000n : name === 'scalar-loop' ? 1000000n : 17971254122360635n;
            assert.equal(r.variables.get('Answer'), expected);
            assert.deepEqual(output, [String(expected)]);
        }
        console.log(JSON.stringify({ case: name, engine: option('engine'), executeMs, peakRssMiB,
            sourceHash: hash(source), mainHash: hash(readFileSync(main, 'utf8')),
            tests: r.testResults.map(({ name, passed, durationMs }) => ({ name, passed, durationMs })),
            ...(option('diagnostics') ? { diagnostics } : {}) }));
    } finally { r.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3);
    assert(Number.isInteger(samples) && samples > 0);
    const versions = { ...(option('before-runtime') ? { before: resolve(option('before-runtime')) } : {}),
        ...(option('guards-runtime') ? { guards: resolve(option('guards-runtime')) } : {}), candidate: runtimePath };
    const cases = option('cases')?.split(',') ?? ['main', 'fixture'];
    const engines = option('engines')?.split(',') ?? ['reference', 'compiled'];
    const results = [];
    for (const name of cases) for (const engine of engines) for (let sample = 0; sample < samples; sample++) {
        const jobs = Object.entries(versions);
        for (const [version, runtime] of sample % 2 ? jobs.reverse() : jobs) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`,
                `--engine=${engine}`, `--runtime=${runtime}`,
                ...(option('diagnostics') ? ['--diagnostics=true'] : [])], { encoding: 'utf8', timeout: 120000 });
            assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
            const result = { sample, version, ...JSON.parse(child.stdout) };
            results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
        }
    }
    const runtimeHashes = Object.fromEntries(Object.entries(versions).map(([version, path]) => [version,
        Object.fromEntries(['mutation-guards.js', 'array-binding-contract.js'].map(file => [file,
            hash(readFileSync(resolve(dirname(path), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        measurements: 'serial fresh processes; parse and complete execution; peak RSS before assertions; diagnostics separate',
        runtimeHashes, results }, null, 2));
}
