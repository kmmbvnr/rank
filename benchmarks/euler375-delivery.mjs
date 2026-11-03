import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
const baseline = process.env.BASELINE_RUNTIME;
assert.ok(baseline, 'BASELINE_RUNTIME must name the built interpreter before these changes');
const current = process.env.RUNTIME || new URL('../packages/interpreter/out/index.js', import.meta.url).pathname;
const trials = Number(process.env.TRIALS || 3), samples = [];
const run = 'benchmarks/euler375-investigation.mjs', original = 'benchmarks/experiments/euler375-original.ra';
const grow = 'benchmarks/experiments/euler375-grow.ra';
let jobs = [
    ['original-before', baseline, [run, original, 'compiled']],
    ['original-after', current, [run, original, 'compiled']],
    ['production', current, [run]],
    ['grow-small-before', baseline, [run, grow, 'compiled', '100000', '100000']],
    ['grow-small-after', current, [run, grow, 'compiled', '100000', '100000']],
];
for (const id of ['350', '364', '365']) for (const [policy, runtime] of [['before', baseline], ['after', current]]) {
    jobs.push([`${id}-${policy}`, runtime, ['benchmarks/experiments/euler374-neighbours.mjs', id]]);
}
if (process.env.CASES) jobs = jobs.filter(([label]) => process.env.CASES.split(',').includes(label));
for (let trial = 0; trial < trials; trial++) {
    for (const [label, runtime, args] of trial % 2 ? [...jobs].reverse() : jobs) {
        const child = spawnSync(process.execPath, args, {encoding: 'utf8', env: {...process.env, RUNTIME: runtime, CONTROL: 'production', DIAG: '', PROFILE: ''}});
        assert.equal(child.status, 0, `${label}: ${child.stderr}`);
        const result = JSON.parse(child.stdout.trim());
        if (label.startsWith('grow-small')) assert.equal(result.answer, '55258601351663');
        const sample = {trial, label, ...result}; samples.push(sample); console.log(JSON.stringify(sample));
    }
}
const report = {node: process.version, arch: process.arch, cpu: os.cpus()[0].model, trials, baseline, current, samples};
if (process.env.OUTPUT) writeFileSync(process.env.OUTPUT, JSON.stringify(report, null, 2) + '\n');
