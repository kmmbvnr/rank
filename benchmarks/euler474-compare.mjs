import { spawnSync } from 'node:child_process';
import { loadavg, freemem, totalmem } from 'node:os';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [baselineRuntime, rounds = '3'] = process.argv.slice(2);
if (!baselineRuntime) throw Error('Pass the frozen baseline interpreter/out/index.js');
const runs = [];
const variants = [
    { name: 'original', runtime: baselineRuntime, file: 'benchmarks/fixtures/euler474-original.ra' },
    { name: 'compact-rows-only', file: 'benchmarks/fixtures/euler474-original.ra' },
    { name: 'final', file: 'demos/euler/474_lastdigitsdivisors.ra' },
];
for (const mode of ['compiled', 'reference']) for (let round = 0; round < Number(rounds); round++) {
    const order = round % 2 ? variants.toReversed() : variants;
    for (const variant of order) {
        const environment = { load: loadavg(), freeMiB: freemem() / 1048576, totalMiB: totalmem() / 1048576 };
        const started = new Date().toISOString();
        const env = { ...process.env };
        if (variant.runtime) env.RANK474_RUNTIME = variant.runtime; else delete env.RANK474_RUNTIME;
        const result = spawnSync(process.execPath, ['benchmarks/euler474.mjs', mode, '10000', variant.file],
            { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
        if (result.status !== 0) throw Error(result.stderr || String(result.error));
        const run = { variant: variant.name, round, started, environment, ...JSON.parse(result.stdout) };
        runs.push(run);
        process.stderr.write(`${mode} ${round} ${variant.name}: ${run.ms.toFixed(1)} ms ${run.rssMiB.toFixed(1)} MiB\n`);
    }
}
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
console.log(JSON.stringify({ note: 'Loaded-host exploratory paired comparisons; no claim of idle-host timing.',
    node: process.version, arch: process.arch,
    kernelSha256: sha('packages/interpreter/out/selectors.js'),
    baselineKernelSha256: sha(new URL('./selectors.js', `file://${baselineRuntime}`)), runs }, null, 2));
