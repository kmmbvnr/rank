// Build first. Save baseline out/ and demos/euler/ before editing, then run:
// node benchmarks/euler-intersections.mjs --before=/absolute/path/to/snapshot
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = source => createHash('sha256').update(source).digest('hex');
const runtime = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
const sources = resolve(option('sources') ?? resolve(root, 'demos/euler'));
const controls = {
    scalar: 'use io\nTotal = 0\nfor I in 1 to 100000\n A = I * 7 + 3\n B = A mod 19\n Total += B\nend\nTotal print',
    indexed: 'use sequences\nuse io\nValues = 1 to 100 array\nTotal = 0\nfor I in 1 to 100000\n Total += Values (I mod 100) * 7 + 3\nend\nTotal print',
};

if (option('worker')) {
    const name = option('worker'), engine = option('engine');
    const file = resolve(sources, name === 'fixture' ? '165_intersections_test.ra' : '165_intersections.ra');
    const source = controls[name] ?? readFileSync(file, 'utf8');
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtime));
    const output = [], diagnostics = new RuntimeDiagnostics();
    const r = new Interpreter(line => output.push(line), {
        compilation: engine !== 'reference', testing: true, sourceId: file,
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
            assert.deepEqual(r.testResults[1].output, ['11064', '113849']);
            const firstCount = Number(source.match(/Segs\s*=\s*(\d+)/)?.[1]);
            assert([1, 300].includes(firstCount));
            assert.deepEqual(r.testResults[0].output, [firstCount === 1 ? '0' : '11064']);
        } else {
            let expected = 2868868n;
            if (name === 'indexed') expected = 35650000n;
            if (name === 'scalar') {
                expected = 0n;
                for (let i = 1n; i <= 100000n; i++) expected += (i * 7n + 3n) % 19n;
            }
            assert.equal(r.variables.get(controls[name] ? 'Total' : 'Answer'), expected);
            assert.deepEqual(output, [String(expected)]);
        }
        console.log(JSON.stringify({ case: name, engine, executeMs, peakRssMiB, sourceHash: hash(source),
            mainHash: hash(readFileSync(resolve(sources, '165_intersections.ra'), 'utf8')),
            tests: r.testResults, ...(option('diagnostics') ? { diagnostics } : {}) }));
    } finally { r.dispose(); }
} else {
    const before = option('before');
    const versions = before ? {
        before: { runtime: resolve(before, 'out/index.js'), sources: resolve(before, 'demos/euler') },
        fixtureOnly: { runtime: resolve(before, 'out/index.js'), sources },
        candidate: { runtime, sources },
    } : { candidate: { runtime, sources } };
    const samples = Number(option('samples') ?? 3);
    assert(Number.isInteger(samples) && samples > 0);
    const cases = option('cases')?.split(',') ?? ['fixture', 'main', 'scalar', 'indexed'];
    const results = [];
    for (const name of cases) for (const engine of name === 'main' ? ['compiled'] : ['reference', 'compiled']) {
        for (let sample = 0; sample < samples; sample++) {
            // Main and scalar sources do not change between versions.
            const jobs = Object.entries(versions).filter(([version]) => name === 'fixture' || version !== 'fixtureOnly');
            for (const [version, paths] of sample % 2 ? jobs.reverse() : jobs) {
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`,
                    `--engine=${engine}`, `--runtime=${paths.runtime}`, `--sources=${paths.sources}`,
                    ...(option('diagnostics') ? ['--diagnostics=true'] : [])], { encoding: 'utf8', timeout: 120000 });
                assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
                const result = { sample, version, ...JSON.parse(child.stdout) };
                results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
            }
        }
    }
    const runtimeHashes = Object.fromEntries(Object.entries(versions).map(([version, paths]) => [version,
        Object.fromEntries(['eval/expressions.js', 'operators.js', 'value-selection.js', 'numeric-collections.js', 'sequence.js'].map(file =>
            [file, hash(readFileSync(resolve(dirname(paths.runtime), file)))]))]));
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples, runtimeHashes,
        measurements: 'serial fresh processes; alternating order; parse and execution; RSS before assertions; diagnostics separate',
        results }, null, 2));
}
