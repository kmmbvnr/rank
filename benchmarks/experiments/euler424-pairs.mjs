import { spawnSync } from 'node:child_process';
const baseline = process.env.RANK424_BASE_RUNTIME;
const source = process.argv[2] ?? 'demos/euler/424_kakuro.ra';
if (!baseline) throw Error('set RANK424_BASE_RUNTIME to a built baseline interpreter URL');
for (let sample = 0; sample < 3; sample++) {
    for (const [variant, runtime, file] of [
        ['before', baseline, 'benchmarks/experiments/euler424-original.ra'],
        ['source-only', baseline, source],
        ['after', undefined, source],
    ]) {
        const result = spawnSync(process.execPath, ['benchmarks/experiments/euler424-run.mjs', 'compiled', '200', file], {
            encoding: 'utf8', env: { ...process.env, ...(runtime ? { RANK424_RUNTIME: runtime } : {}) },
        });
        if (result.status !== 0) throw Error(result.stderr);
        const observation = JSON.parse(result.stdout);
        if (observation.answer !== '1059760019628') throw Error('wrong answer');
        console.log(JSON.stringify({ sample, variant, ...observation }));
    }
}
