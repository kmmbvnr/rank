// Build first. Run samples serially, without concurrent tests or profilers.
// node benchmarks/euler-product-sums.mjs --samples=3 [--runtime=/path/to/out/index.js]
// --baseline-runtime=/path/to/old/out/index.js pairs both runtimes for stack/fixture.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const file = resolve(root, 'demos/euler/088_productsum_stack.ra');
const original = readFileSync(resolve(root, 'benchmarks/fixtures/euler088-stack.ra'), 'utf8');
const scalar = original.replace('Todo push array 1 0 0 2', 'Todo push 1\nTodo push 0\nTodo push 0\nTodo push 2')
    .replace('  Frame = Todo pop\n  unpack Prod Sum Cnt Low = Frame', '  Low = Todo pop\n  Cnt = Todo pop\n  Sum = Todo pop\n  Prod = Todo pop')
    .replace('    Todo push array Next (Sum + F) (Cnt + 1) F', '    Todo push Next\n    Todo push (Sum + F)\n    Todo push (Cnt + 1)\n    Todo push F');
const pruned = readFileSync(file, 'utf8');
const lazy = original.replace('  K = Prod - Sum + Cnt', "  K' = Prod - Sum + Cnt")
    .replace('    Next = Prod * F', "    Next' = Prod * F");
const cases = [
    { name: 'stack', source: original },
    { name: 'fixture', source: readFileSync(resolve(root, 'benchmarks/fixtures/euler088-stack_test.ra'), 'utf8'), tests: 3, module: original },
    { name: 'scalar', source: scalar },
    { name: 'pruned', source: pruned },
    { name: 'pruned-fixture', source: readFileSync(file.replace('.ra', '_test.ra'), 'utf8'), tests: 3 },
    { name: 'lazy', source: lazy },
];

// Independent numeric DFS: compare every minimum, not just the final checksum.
function oracle(prune = false) {
    const limit = 12000, big = 2 * limit, best = Array(limit + 1).fill(big);
    let frames = 0;
    const todo = [[1, 0, 0, 2]];
    while (todo.length) {
        const [product, sum, count, low] = todo.pop();
        frames++;
        const k = product - sum + count;
        if (count > 1 && k <= limit) best[k] = Math.min(best[k], product);
        let high = Math.floor(big / product);
        if (prune && product > 1) high = Math.min(high, Math.floor((limit + sum - count - 1) / (product - 1)));
        for (let factor = low; factor <= high; factor++) todo.push([product * factor, sum + factor, count + 1, factor]);
    }
    assert.equal([...new Set(best.slice(2))].reduce((sum, value) => sum + value, 0), 7587457);
    return { best, frames };
}

if (option('worker')) {
    const entry = cases.find(entry => entry.name === option('worker'));
    assert(entry);
    const runtimePath = resolve(option('runtime') ?? resolve(root, 'packages/interpreter/out/index.js'));
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(runtimePath));
    const output = [], diagnostics = new RuntimeDiagnostics();
    const sourceId = entry.tests ? file.replace('.ra', '_test.ra') : file;
    const runtime = new Interpreter(line => output.push(line), {
        compilation: option('engine') !== 'reference', testing: true, sourceId,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? sourceId), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: id === file && entry.module ? entry.module : readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        if (option('diagnostics')) diagnostics.run(() => runtime.execute(entry.source));
        else runtime.execute(entry.source);
        const executeMs = performance.now() - start, peakRssKiB = process.resourceUsage().maxRSS;
        if (entry.tests) {
            assert.equal(runtime.testResults.length, entry.tests);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert.deepEqual(runtime.testResults[0].output, ['7587457']);
        } else {
            assert.deepEqual(output, ['7587457']);
            assert.deepEqual(Array.from(runtime.variables.get('Best').items), oracle().best.map(BigInt));
        }
        console.log(JSON.stringify({ case: entry.name, executeMs, peakRssKiB,
            sourceHash: createHash('sha256').update(entry.source).digest('hex'),
            diagnostics: option('diagnostics') ? diagnostics : undefined,
            tests: runtime.testResults.map(test => ({ name: test.name, passed: test.passed, durationMs: test.durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(option('samples') ?? 3), names = option('cases')?.split(',');
    assert(Number.isSafeInteger(samples) && samples > 0);
    const chosen = cases.filter(entry => !names || names.includes(entry.name));
    assert(chosen.length && (!names || chosen.length === names.length));
    const full = oracle(), prunedOracle = oracle(true);
    assert.deepEqual(prunedOracle.best, full.best);
    const versions = option('baseline-runtime')
        ? [{ version: 'before', runtime: option('baseline-runtime') }, { version: 'after', runtime: option('runtime') }]
        : [{ version: 'current', runtime: option('runtime') }];
    const workloads = chosen.flatMap(entry => (['stack', 'fixture'].includes(entry.name) ? versions : versions.slice(-1))
        .map(version => ({ entry, ...version })));
    const results = [];
    for (let sample = 0; sample < samples; sample++) {
        for (const { entry, version, runtime } of sample % 2 ? [...workloads].reverse() : workloads) {
            const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${entry.name}`,
                ...(runtime ? [`--runtime=${runtime}`] : []),
                ...['engine', 'diagnostics'].flatMap(name => option(name) ? [`--${name}=${option(name)}`] : [])],
            { encoding: 'utf8', timeout: 120000 });
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            const result = { sample, version, ...JSON.parse(child.stdout) };
            results.push(result); process.stderr.write(JSON.stringify(result) + '\n');
        }
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples,
        engine: option('engine') ?? 'compiled', runtime: option('runtime') ?? 'current checkout',
        baselineRuntime: option('baseline-runtime'),
        diagnostics: !!option('diagnostics'), frames: { original: full.frames, pruned: prunedOracle.frames },
        measurements: 'serial fresh processes; complete execution including parsing; process peak RSS before oracle validation',
        results }, null, 2));
}
