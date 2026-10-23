// Build first. Each sample uses a fresh process; diagnostics are outside timing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const iterations = Number(option('iterations') ?? 2000000);
const trials = Number(option('trials') ?? 3);
const counts = [32, 33, 40, 100];
assert.ok(Number.isSafeInteger(iterations) && iterations > 0);
assert.ok(Number.isSafeInteger(trials) && trials > 0);
const worker = option('worker');
if (worker) {
    const count = Number(worker);
    const { Interpreter, RuntimeDiagnostics, parse } = await import(option('runtime')
        ? pathToFileURL(option('runtime')).href : '../packages/interpreter/out/index.js');
    const source = n => `S = 0\nT = 0\nfor R in 1 to ${n}\n${
        Array.from({ length: count - 1 }, (_, i) => `  A = S + ${i}`).join('\n')
    }\n  T += R\nend\nT`;
    let generatedBytes = 0;
    const runtime = new Interpreter(() => {}, {
        onIntegerLoopCompiled: code => { generatedBytes += Buffer.byteLength(code); },
    });
    try {
        // Excludes parsing; includes validation, lowering, code generation and one
        // iteration. This is an upper bound on compilation, not compiler-only time.
        const program = parse(source(1));
        const preparationStart = performance.now();
        assert.equal(runtime.executeProgram(program), 1n);
        const preparationMs = performance.now() - preparationStart;
        runtime.execute(source(1000));
        const start = performance.now();
        const result = runtime.execute(source(iterations));
        const ms = performance.now() - start;
        assert.equal(result, BigInt(iterations) * (BigInt(iterations) + 1n) / 2n);
        const diagnostics = new RuntimeDiagnostics();
        assert.equal(diagnostics.run(() => runtime.execute(source(10))), 55n);
        console.log(JSON.stringify({ count, ms, preparationMs, generatedBytes, result: String(result),
            compiledLoops: diagnostics.compiledLoops, numberLoops: diagnostics.numberLoops,
            fallbacks: diagnostics.fallbacks }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, iterations, trials,
        timing: 'fresh processes, 1000-iteration warmup, parsing included; preparation excludes parsing' }));
    const medians = {};
    for (const [variant, runtime] of [['candidate', undefined],
        ...(option('baseline') ? [['baseline', option('baseline')]] : [])]) {
        for (const count of counts) {
            const samples = [];
            for (let trial = 0; trial < trials; trial++) {
                const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${count}`,
                    `--iterations=${iterations}`, ...(runtime ? [`--runtime=${runtime}`] : [])],
                { encoding: 'utf8', timeout: 120000 });
                assert.equal(child.status, 0, child.stderr || String(child.error));
                const result = JSON.parse(child.stdout);
                console.log(JSON.stringify({ variant, trial, ...result }));
                samples.push(result.ms);
            }
            medians[`${variant}:${count}`] = samples.sort((a, b) => a - b)[Math.floor(trials / 2)];
        }
    }
    console.log(JSON.stringify({ medians }));
}
