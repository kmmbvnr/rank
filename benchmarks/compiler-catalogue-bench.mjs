// Run after building both checkouts, with no other local test/benchmark jobs.
// node benchmarks/compiler-catalogue-bench.mjs BASELINE CANDIDATE [SAMPLES] [CASE] [baseline|candidate]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { cpus } from 'node:os';

const [baselinePath, candidatePath, sampleCount = '5', selectedCase, first = 'baseline'] = process.argv.slice(2);
assert(baselinePath && candidatePath, 'Provide baseline and candidate checkout paths');
const samples = Number(sampleCount);
assert(Number.isSafeInteger(samples) && samples >= 3);
assert(['baseline', 'candidate'].includes(first));
const order = first === 'baseline' ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
const roots = { baseline: resolve(baselinePath), candidate: resolve(candidatePath) };
const modulus = 1000000007;
const heights = Array.from({ length: 3000 }, (_, i) => i * 37 % 10000 + 1);
const jumps = 100, costs = Array(heights.length).fill(Infinity);
costs[0] = 0;
for (let i = 1; i < heights.length; i++) {
    for (let j = Math.max(0, i - jumps); j < i; j++) {
        costs[i] = Math.min(costs[i], costs[j] + Math.abs(heights[i] - heights[j]));
    }
}
function coinWays(target, coins) {
    const ways = Array(target + 1).fill(0);
    ways[0] = 1;
    for (let total = 1; total <= target; total++) {
        for (const coin of coins) if (coin <= total) ways[total] = (ways[total] + ways[total - coin]) % modulus;
    }
    return String(ways[target]);
}
const coins = [1, 3, 4, 7, 11, 23, 50, 99], target = 20000;
const cases = [
    { name: 'Euler 004', source: 'demos/euler/004_palproduct.ra', expected: '906609' },
    { name: 'Euler 014', source: 'demos/euler/014_collatz.ra', expected: '837799' },
    { name: 'AtCoder Frog 2', source: 'demos/atcoder/edpc/02_frog2.ra',
        input: `${heights.length} ${jumps}\n${heights.join(' ')}\n`, expected: String(costs.at(-1)) },
    { name: 'CSES Coin Combinations I', source: 'demos/cses/dynamic/003_coincomb1.ra',
        input: `${coins.length} ${target}\n${coins.join(' ')}\n`, expected: coinWays(target, coins) },
    { name: 'CSES Dice Combinations', source: 'demos/cses/dynamic/001_dice.ra',
        input: '100000\n', expected: coinWays(100000, [1, 2, 3, 4, 5, 6]) },
];
function run(root, benchmark) {
    const start = performance.now();
    const child = spawnSync(process.execPath, [resolve(root, 'packages/cli/bin/cli.js'), benchmark.source], {
        cwd: root, input: benchmark.input ?? '', encoding: 'utf8', timeout: 120000,
    });
    const elapsed = performance.now() - start;
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    assert.equal(child.stdout.trim(), benchmark.expected, benchmark.name);
    return elapsed;
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
assert(selectedCase === undefined || cases.some(benchmark => benchmark.name === selectedCase), 'Unknown case');
const results = [];
for (const benchmark of cases.filter(benchmark => selectedCase === undefined || benchmark.name === selectedCase)) {
    // Warm both implementations, then alternate which one runs first.
    for (const kind of order) run(roots[kind], benchmark);
    const times = { baseline: [], candidate: [] };
    for (let sample = 0; sample < samples; sample++) {
        for (const kind of sample % 2 ? [...order].reverse() : order) {
            times[kind].push(run(roots[kind], benchmark));
        }
    }
    const before = median(times.baseline), after = median(times.candidate);
    const result = { name: benchmark.name, source: benchmark.source, expected: benchmark.expected,
        milliseconds: times, baselineMedian: before, candidateMedian: after, ratio: after / before };
    results.push(result);
    process.stderr.write(`${benchmark.name}: ${before.toFixed(0)} -> ${after.toFixed(0)} ms (${result.ratio.toFixed(3)}x)\n`);
}
const revisions = Object.fromEntries(Object.entries(roots).map(([kind, root]) => [kind,
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()]));
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, samples, first, revisions, results }, null, 2));
