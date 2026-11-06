import { spawnSync } from 'node:child_process';
const baseline = process.env.RANK428_BASE_RUNTIME;
if (!baseline) throw Error('set RANK428_BASE_RUNTIME to a baseline interpreter file URL');
const mode = process.argv[2] ?? 'compiled';
const variants = [
    ['before', baseline, 'benchmarks/experiments/euler428-original.ra'],
    ['compiler-only', undefined, 'benchmarks/experiments/euler428-original.ra'],
    ['source-only', baseline, 'demos/euler/428_necklacetriplets.ra'],
    ['after', undefined, 'demos/euler/428_necklacetriplets.ra'],
];
for (let sample = 0; sample < 3; sample++) for (const [variant, runtime, file] of (sample % 2 ? [...variants].reverse() : variants)) {
    if (mode === 'reference' && !['before', 'after'].includes(variant)) continue;
    const child = spawnSync(process.execPath, ['benchmarks/experiments/euler428-run.mjs', mode, '1000000000', file], {
        encoding: 'utf8', env: { ...process.env, ...(runtime ? { RANK428_RUNTIME: runtime } : {}) },
    });
    if (child.status !== 0) throw Error(child.stderr);
    const value = JSON.parse(child.stdout);
    if (value.answer !== '747215561862') throw Error('wrong full answer');
    console.log(JSON.stringify({ sample, variant, ...value }));
}
