// Build first. Each sample runs the unchanged main and fixture in a fresh process.
// node benchmarks/euler-pentagonal-difference.mjs [interpreter/out/index.js] [samples=3] [baseline-module]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
if (process.argv[2] === '--sample') {
    const [module, name, engine] = process.argv.slice(3);
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(module).href);
    const file = resolve(root, 'demos/euler', name);
    const output = [], diagnostics = new RuntimeDiagnostics();
    let scalarFunctions = 0;
    const runtime = new Interpreter(line => output.push(line), {
        compilation: engine === 'compiled', testing: true, sourceId: file,
        onScalarFunctionExecuted: () => scalarFunctions++,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        diagnostics.run(() => runtime.execute(readFileSync(file, 'utf8')));
        const elapsedMs = performance.now() - start;
        if (name.endsWith('_test.ra')) {
            assert.equal(runtime.testResults.length, 2);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert.deepEqual(runtime.testResults[0].output, ['5482660']);
        } else assert.deepEqual(output, ['5482660']);
        console.log(JSON.stringify({ name, engine, elapsedMs,
            scalarFunctions, compiledTensors: diagnostics.compiledTensors, cellsComputed: diagnostics.cellsComputed, fallbacks: diagnostics.fallbacks }));
    } finally { runtime.dispose(); }
} else {
    const module = resolve(root, process.argv[2] ?? 'packages/interpreter/out/index.js');
    const baselineModule = process.argv[4] ? resolve(root, process.argv[4]) : undefined;
    const variants = baselineModule ? [{ version: 'before', module: baselineModule }, { version: 'after', module }]
        : [{ module }];
    const samples = Number(process.argv[3] ?? 3);
    assert(Number.isSafeInteger(samples) && samples >= 1);
    const results = [];
    for (const name of ['044_pentagondiff.ra', '044_pentagondiff_test.ra']) {
        for (let sample = 0; sample < samples; sample++) {
            for (const engine of sample % 2 ? ['compiled', 'reference'] : ['reference', 'compiled']) {
                for (const variant of sample % 2 ? [...variants].reverse() : variants) {
                    const child = spawnSync(process.execPath, [script, '--sample', variant.module, name, engine], {
                        cwd: root, encoding: 'utf8', timeout: 120_000,
                    });
                    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
                    const result = { sample, ...(variant.version ? { version: variant.version } : {}), ...JSON.parse(child.stdout) };
                    results.push(result);
                    process.stderr.write(JSON.stringify(result) + '\n');
                }
            }
        }
    }
    console.log(JSON.stringify({ node: process.version, module, baselineModule, samples, results }, null, 2));
}
