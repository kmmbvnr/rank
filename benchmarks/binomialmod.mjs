// npm run build && node benchmarks/binomialmod.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).map(argument => {
    const match = /^--(worker|mode|samples|size|limit|runtime)=(.+)$/.exec(argument);
    if (!match) throw Error(`Unknown argument: ${argument}`);
    return [match[1], match[2]];
}));
const { Interpreter } = await import(options.runtime ? pathToFileURL(resolve(options.runtime)).href
    : new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const size = Number(options.size ?? 2000000), limit = Number(options.limit ?? 10000000);
const samples = Number(options.samples ?? 3), mode = options.mode ?? 'lifted';
assert(['scalar', 'lifted'].includes(mode));
assert([size, limit, samples].every(value => Number.isSafeInteger(value) && value > 0));
assert(size <= limit && limit < 1000000007);
const time = action => { const start = performance.now(); const value = action(); return { ms: performance.now() - start, value }; };

if (options.worker) {
    const runtime = new Interpreter();
    try {
        runtime.execute('use numbers\nuse sequences');
        // Independent exact-binomial oracle for the lifted scalar body.
        if (mode === 'lifted') assert.equal(runtime.execute('OracleN = ((20 to 40) copy) reshape 21 1\nOracleK = (0 to 20) copy\n' +
            '((OracleN OracleK 101 binomialmod) equal ((OracleN binomial OracleK) mod 101)) all'), true);
        else assert.equal(runtime.execute('40 20 101 binomialmod'), runtime.execute('(40 binomial 20) mod 101'));
        const cold = time(() => runtime.execute(`${limit} ${Math.floor(limit / 3)} 1000000007 binomialmod`));
        const heapUsed = process.memoryUsage().heapUsed;
        runtime.execute(`N = (${limit - size + 1} to ${limit}) copy\nK = N // 3`);
        const result = time(() => runtime.execute(mode === 'lifted'
            ? '(N K 1000000007 binomialmod) sum'
            : `S = 0\nfor I in ${limit - size + 1} to ${limit}\n S += I (I // 3) 1000000007 binomialmod\nend\nS`));
        if (size === 2000000 && limit === 10000000) assert.equal(result.value, 999868997833556n);
        console.log(JSON.stringify({ mode, size, limit, coldMs: cold.ms, warmMs: result.ms,
            heapUsed, checksum: String(result.value) }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, mode, size, limit, samples }));
    const results = [];
    for (let sample = 0; sample < samples; sample++) {
        const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--worker=true',
            `--mode=${mode}`, `--size=${size}`, `--limit=${limit}`,
            ...(options.runtime ? [`--runtime=${resolve(options.runtime)}`] : [])], { encoding: 'utf8' });
        if (child.status !== 0) throw Error(child.stderr || `worker exited ${child.status}`);
        const result = JSON.parse(child.stdout);
        results.push(result);
        console.log(JSON.stringify({ sample: sample + 1, ...result }));
    }
    assert(results.every(result => result.checksum === results[0].checksum));
    const median = key => results.map(result => result[key]).sort((a, b) => a - b)[Math.floor(samples / 2)];
    console.log(JSON.stringify({ medianColdMs: median('coldMs'), medianWarmMs: median('warmMs') }));
}
