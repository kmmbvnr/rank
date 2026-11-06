import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
const baseline = process.env.RANK423_BASE_RUNTIME;
if (!baseline) throw Error('set RANK423_BASE_RUNTIME to the baseline built interpreter URL');
const variants = [
    ['before', baseline, 'benchmarks/experiments/euler423-original.ra'],
    ['after', undefined, 'demos/euler/423_consecutive.ra'],
    ['ordinary-primes', undefined, 'benchmarks/experiments/euler423-ordinary.ra'],
];
writeFileSync('benchmarks/experiments/euler423-ordinary.ra', readFileSync('demos/euler/423_consecutive.ra', 'utf8').replace('Primes = L primesieve array', 'Primes = primes to L array'));
for (let sample = 0; sample < 3; sample++) {
    for (const [variant, runtime, file] of variants) {
        const result = spawnSync(process.execPath, ['benchmarks/experiments/euler423-run.mjs', 'compiled', '50000000', file], {
            encoding: 'utf8', env: { ...process.env, ...(runtime ? { RANK423_RUNTIME: runtime } : {}) },
        });
        if (result.status !== 0) throw Error(result.stderr);
        const observation = JSON.parse(result.stdout);
        if (observation.answer !== '653972374') throw Error('wrong answer');
        console.log(JSON.stringify({ sample, variant, ...observation }));
    }
}
