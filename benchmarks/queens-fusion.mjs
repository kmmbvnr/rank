import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

// npx tsc -b tsconfig.build.json && node benchmarks/queens-fusion.mjs
// Uses the language comparison worker's independent 92-board oracle and timer.
const algorithm = process.env.ALGORITHM ?? 'prefixes';
assert(['prefixes', 'permutations'].includes(algorithm));
const modes = {
    reference: { RANK_ARRAY_COMPILATION: 'false', RANK_RANKED_ARRAY_COMPILATION: 'false' },
    functionFusion: { RANK_ARRAY_COMPILATION: 'true', RANK_RANKED_ARRAY_COMPILATION: 'false' },
    rankedFusion: { RANK_ARRAY_COMPILATION: 'true', RANK_RANKED_ARRAY_COMPILATION: 'true' },
};
if (algorithm === 'permutations') delete modes.rankedFusion;
const samples = Number(process.env.SAMPLES ?? 5);
assert(Number.isSafeInteger(samples) && samples > 0);
const worker = fileURLToPath(new URL('./queens-languages.mjs', import.meta.url));
const result = { cpu: cpus()[0].model, node: process.version, samples, algorithm,
    method: 'Fresh processes, one warmup and calibrated 200 ms batch per sample; parsing, imports and printing excluded. Each solve retains and verifies all 92 boards against an independent oracle. Mode order rotates. Times are milliseconds per solve.',
    results: {} };
for (let sample = 0; sample < samples; sample++) {
    const entries = Object.entries(modes);
    const offset = sample % entries.length;
    for (const [name, env] of [...entries.slice(offset), ...entries.slice(0, offset)]) {
        const child = spawnSync(process.execPath, [worker, `--worker=${algorithm}`], {
            encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000,
        });
        assert.equal(child.status, 0, child.stderr || String(child.error));
        const { ms, iterations, checksum } = JSON.parse(child.stdout);
        assert.equal(checksum, 92 * iterations);
        (result.results[name] ??= { runs: [] }).runs.push({ ms, iterations });
        console.error(`${name} ${sample + 1}/${samples}: ${ms.toFixed(3)} ms`);
    }
}
for (const entry of Object.values(result.results)) {
    entry.medianMs = entry.runs.map(run => run.ms).sort((a, b) => a - b)[Math.floor(samples / 2)];
}
console.log(JSON.stringify(result, null, 2));
