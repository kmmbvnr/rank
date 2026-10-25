// Build first; run without concurrent tests, builds or profilers.
// node benchmarks/euler-prime-pairs.mjs --samples=3 [--runtime=/path/to/out/index.js]
// --engine=reference disables compilation; --cases=graph,lazy,bits,dense selects cases.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(import.meta.url);
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const load = path => readFileSync(resolve(root, path), 'utf8');
const original = load('benchmarks/fixtures/euler060-graph.ra');
const selected = load('demos/euler/060_primepairs.ra');
// Allocate an explicit sieve covering every possible concatenation below Limit.
// Its preparation is part of the timed source, not benchmark setup.
const dense = original.replace('fun Limit build\n', `fun Limit build
  Scale = 10
  for Scale less Limit
    Scale *= 10
  end
  Checks = ((Limit - 1) * Scale + Limit - 1) primesieve
`).replaceAll('Forward in primes', 'Forward in Checks').replaceAll('Backward in primes', 'Backward in Checks');
const cases = [
    { name: 'graph', source: original },
    { name: 'lazy', source: load('benchmarks/fixtures/euler060-lazy.ra') },
    { name: 'bits', source: selected },
    { name: 'dense', source: dense },
    { name: 'graph-fixture', source: load('benchmarks/fixtures/euler060-graph_test.ra'), module: original, tests: 8 },
    { name: 'bits-fixture', source: load('demos/euler/060_primepairs_test.ra'), module: selected, tests: 10 },
];
if (option('worker')) {
    const entry = cases.find(entry => entry.name === option('worker'));
    assert(entry);
    const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
    const { Interpreter } = await import(pathToFileURL(runtimePath));
    const output = [];
    const file = resolve(root, 'demos/euler/060_primepairs' + (entry.tests ? '_test' : '') + '.ra');
    const runtime = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId: file,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: id.endsWith('/060_primepairs.ra') && entry.module ? entry.module : readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        runtime.execute(entry.source);
        const executeMs = performance.now() - start;
        const peakRssKiB = process.resourceUsage().maxRSS;
        // Keep runtime variables alive: this measures live post-run state, not a
        // disposed interpreter. GC is outside the measured execution interval.
        assert(global.gc, 'Workers must run with --expose-gc');
        global.gc();
        const memory = process.memoryUsage();
        if (entry.tests) {
            assert.equal(runtime.testResults.length, entry.tests);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert.deepEqual(runtime.testResults[0].output, ['26033']);
        } else {
            assert.deepEqual(output, ['26033']);
            assert.equal(runtime.variables.get('Upper'), 26033n);
            assert.equal(runtime.variables.get('Answer'), 26033n);
        }
        console.log(JSON.stringify({ case: entry.name, executeMs, peakRssKiB,
            heapUsedAfterGc: memory.heapUsed, externalAfterGc: memory.external,
            arrayBuffersAfterGc: memory.arrayBuffers, rssAfterGc: memory.rss,
            sourceHash: createHash('sha256').update(entry.source).digest('hex'),
            tests: runtime.testResults.map(test => ({ name: test.name, passed: test.passed, durationMs: test.durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3), names = option('cases')?.split(',');
    assert(Number.isSafeInteger(samples) && samples > 0);
    const chosen = cases.filter(entry => !names || names.includes(entry.name));
    assert(chosen.length && (!names || chosen.length === names.length));
    const results = [];
    for (let sample = 0; sample < samples; sample++) {
        for (const entry of sample % 2 ? [...chosen].reverse() : chosen) {
            const child = spawnSync(process.execPath, ['--expose-gc', script, `--worker=${entry.name}`,
                ...(option('runtime') ? [`--runtime=${option('runtime')}`] : []),
                ...(option('engine') ? [`--engine=${option('engine')}`] : [])],
            { encoding: 'utf8', timeout: 120000 });
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            const result = { sample, ...JSON.parse(child.stdout) };
            results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
        }
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        engine: option('engine') ?? 'compiled', runtime: option('runtime') ?? 'current checkout',
        measurements: 'serial fresh processes; process peak RSS through execution; heap and external after forced GC with interpreter alive',
        results }, null, 2));
}
