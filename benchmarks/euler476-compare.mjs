import { spawnSync } from 'node:child_process';
import { loadavg, freemem, totalmem } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [baselineRuntime, rounds = '3', limit = '600'] = process.argv.slice(2);
if (!baselineRuntime) throw Error('Pass the frozen baseline interpreter/out/index.js');
const runs = [];
const variants = [
    { name: 'original', runtime: baselineRuntime, file: 'benchmarks/fixtures/euler476-original.ra' },
    { name: 'compiler-runtime-only', file: 'benchmarks/fixtures/euler476-original.ra' },
    { name: 'final', file: 'demos/euler/476_circlepacking.ra' },
];
for (const mode of ['compiled', 'reference']) for (let round = 0; round < Number(rounds); round++) {
    const order = round % 2 ? variants.toReversed() : variants;
    for (const variant of order) {
        const environment = { load: loadavg(), freeMiB: freemem() / 1048576, totalMiB: totalmem() / 1048576 };
        const started = new Date().toISOString();
        const env = { ...process.env };
        if (variant.runtime) env.RANK476_RUNTIME = variant.runtime; else delete env.RANK476_RUNTIME;
        const result = spawnSync(process.execPath, ['benchmarks/euler476.mjs', mode, limit, variant.file],
            { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        if (result.status !== 0) throw Error(result.stderr || String(result.error));
        const run = { variant: variant.name, round, started, environment, ...JSON.parse(result.stdout) };
        runs.push(run);
        process.stderr.write(`${mode} ${round} ${variant.name}: ${run.ms.toFixed(1)} ms ${run.rssMiB.toFixed(1)} MiB\n`);
    }
}
const files = ['fast-paths.js', 'function-plan.js', 'jit/real-array-function.js',
    'jit/number-loop-runtime.js', 'jit/integer-loop-expressions.js', 'jit/tensor-inline.js',
    'jit/tensor-ir.js', 'runtime/owned-array.js'];
function kernel(base) {
    const digest = createHash('sha256');
    for (const file of files) {
        const path = new URL(file, base);
        digest.update(file).update(existsSync(path) ? readFileSync(path) : '<absent>');
    }
    return digest.digest('hex');
}
console.log(JSON.stringify({ note: 'Loaded-host exploratory paired comparisons; no claim of idle-host timing.',
    node: process.version, arch: process.arch, kernelFiles: files,
    kernelSha256: kernel(new URL('../packages/interpreter/out/', import.meta.url)),
    baselineKernelSha256: kernel(new URL('./', `file://${baselineRuntime}`)), runs }, null, 2));
