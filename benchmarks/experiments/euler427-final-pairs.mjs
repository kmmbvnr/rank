import { spawnSync } from 'node:child_process';
const mode = process.argv[2] ?? 'compiled', n = process.argv[3] ?? '7500000';
for (let sample = 0; sample < 3; sample++) for (const [variant, file] of [
    ['before', 'benchmarks/experiments/euler427-original.ra'],
    ['after', 'demos/euler/427_nsequences.ra'],
]) {
    const child = spawnSync(process.execPath, ['benchmarks/experiments/euler427-run.mjs', mode, n, file], { encoding: 'utf8' });
    if (child.status !== 0) throw Error(child.stderr);
    const value = JSON.parse(child.stdout);
    const expected = n === '7500000' ? '97138867' : n === '100000' ? '231545976' : undefined;
    if (expected && value.answer !== expected) throw Error('wrong checkpoint answer');
    console.log(JSON.stringify({ sample, variant, ...value }));
}
