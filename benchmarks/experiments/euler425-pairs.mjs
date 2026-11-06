import { spawnSync } from 'node:child_process';
const baseline = process.env.RANK425_BASE_RUNTIME;
if (!baseline) throw Error('set RANK425_BASE_RUNTIME to the baseline interpreter file URL');
for (let sample = 0; sample < 3; sample++) for (const [variant, runtime, file] of [
    ['before', baseline, 'benchmarks/experiments/euler425-original.ra'],
    ['source-only', baseline, 'demos/euler/425_primeconnection.ra'],
    ['after', undefined, 'demos/euler/425_primeconnection.ra'],
]) {
    const child = spawnSync(process.execPath, ['benchmarks/experiments/euler425-run.mjs', 'compiled', '10000000', file], {
        encoding: 'utf8', env: { ...process.env, ...(runtime ? { RANK425_RUNTIME: runtime } : {}) },
    });
    if (child.status !== 0) throw Error(child.stderr);
    const value = JSON.parse(child.stdout);
    if (value.answer !== '46479497324') throw Error('wrong full answer');
    console.log(JSON.stringify({ sample, variant, ...value }));
}
