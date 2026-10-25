// Build first. Each sample runs the main and all five fixture tests in a fresh process.
// node benchmarks/euler-poker.mjs [interpreter/out/index.js] [samples=3]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = resolve(dirname(script), '..');
if (process.argv[2] === '--sample') {
    const [module, name, engine, sourcePath] = process.argv.slice(3);
    const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(module).href);
    const file = resolve(root, 'demos/euler', name);
    const output = [], diagnostics = new RuntimeDiagnostics(), files = new Map();
    let scalarFunctions = 0;
    const runtime = new Interpreter(line => output.push(line), {
        io: {
            read: path => files.get(path) ?? readFileSync(resolve(root, path)),
            write: (path, data, append) => {
                const previous = append ? files.get(path) ?? readFileSync(resolve(root, path)) : new Uint8Array();
                files.set(path, new Uint8Array([...previous, ...data]));
            },
        },
        compilation: engine === 'compiled', testing: true, sourceId: file,
        onScalarFunctionExecuted: () => scalarFunctions++,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? file), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: readFileSync(id, 'utf8') };
        },
    });
    try {
        const start = performance.now();
        diagnostics.run(() => runtime.execute(readFileSync(sourcePath ?? file, 'utf8')));
        const elapsedMs = performance.now() - start;
        if (name.endsWith('_test.ra')) {
            assert.equal(runtime.testResults.length, 5);
            assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
            assert.deepEqual(runtime.testResults[0].output, ['376']);
        } else assert.deepEqual(output, ['376']);
        console.log(JSON.stringify({ name, engine, elapsedMs,
            scalarFunctions, compiledTensors: diagnostics.compiledTensors, cellsComputed: diagnostics.cellsComputed, fallbacks: diagnostics.fallbacks, rejections: diagnostics.compilerRejections, tests: runtime.testResults.map(test => ({ name: test.name, durationMs: test.durationMs })) }));
    } finally { runtime.dispose(); }
} else {
    const module = resolve(root, process.argv[2] ?? 'packages/interpreter/out/index.js');
    const samples = Number(process.argv[3] ?? 3);
    assert(Number.isSafeInteger(samples) && samples >= 1);
    const results = [];
    for (const name of ['054_poker.ra', '054_poker_test.ra']) {
        for (let sample = 0; sample < samples; sample++) {
            for (const engine of sample % 2 ? ['compiled', 'reference'] : ['reference', 'compiled']) {
                const child = spawnSync(process.execPath, [script, '--sample', module, name, engine], {
                    cwd: root, encoding: 'utf8', timeout: 120_000,
                });
                assert.equal(child.status, 0, child.error?.message ?? child.stderr);
                const result = { sample, ...JSON.parse(child.stdout) };
                results.push(result);
                process.stderr.write(JSON.stringify(result) + '\n');
            }
        }
    }
    console.log(JSON.stringify({ node: process.version, module, samples, results }, null, 2));
}
