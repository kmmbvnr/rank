import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {cpus} from 'node:os';

const trials = Number(process.env.TRIALS || 3);
const cases = (process.env.CASES || 'main,350,364,365').split(',');
const samples = [];
const root = new URL('../', import.meta.url);
for (let trial = 0; trial < trials; trial++) {
    for (const name of cases) {
        const jobs = name === 'main' ? [
            {args: ['benchmarks/euler374-investigation.mjs', 'original'], control: 'baseline'},
            {args: ['benchmarks/euler374-investigation.mjs', 'production'], control: 'baseline'},
            {args: ['benchmarks/euler374-investigation.mjs', 'production'], control: 'production'},
            {args: ['benchmarks/experiments/euler374-native.mjs'], control: 'production'},
        ] : ['baseline', 'production'].map(control => ({args: ['benchmarks/experiments/euler374-neighbours.mjs', name], control}));
        if (trial % 2) jobs.reverse();
        for (const job of jobs) {
            const run = spawnSync(process.execPath, job.args, {cwd: root, encoding: 'utf8', env: {...process.env, CONTROL: job.control}});
            assert.equal(run.status, 0, run.stderr);
            const sample = {trial, case: name, ...JSON.parse(run.stdout)};
            if (name === 'main') assert.equal(String(sample.answer), '334420941');
            samples.push(sample);
            console.log(JSON.stringify(sample));
        }
    }
}
const result = {node: process.version, arch: process.arch, cpu: cpus()[0].model, trials, samples};
if (process.env.OUTPUT) writeFileSync(process.env.OUTPUT, JSON.stringify(result, null, 2) + '\n');
