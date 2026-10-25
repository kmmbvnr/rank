// npm run build && node --expose-gc benchmarks/ranked-address.mjs
// Timings include parsing/execution and eager result completion, but exclude
// source construction. Heap-use deltas are neither allocation counts nor peak memory.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';

const samples = Number(process.argv[2] ?? 5);
assert(Number.isSafeInteger(samples) && samples > 0);
const cases = [
    {
        name: 'paired-points',
        setup: 'A = (0 till 16384) reshape 256 64\nI = ((0 till 8192) mod 256) array\nJ = ((0 till 8192) mod 64) array\nfun R getcell C = A R C',
        programs: {
            ranked: 'Out = A I J rank 0 0\nOut',
            wrapper: 'Out = I getcell J rank 0 0\nOut',
            loop: 'Out = array shape 8192 fill 0\nfor K in 0 till 8192\n Out K = A (I K) (J K)\nend\nOut',
        },
        shape: [8192], values: Array.from({ length: 8192 }, (_, i) => BigInt((i % 256) * 64 + i % 64)),
    },
    {
        name: 'paired-blocks',
        setup: 'A = (0 till 16384) reshape 256 64\nI = ((0 till 256) mod 256) reshape 64 4\nJ = ((0 till 512) mod 64) reshape 64 8\nfun R block C = A R C',
        programs: { ranked: 'Out = A I J rank 1 1\nOut', wrapper: 'Out = I block J rank 1 1\nOut' },
        shape: [64, 4, 8], values: Array.from({ length: 2048 }, (_, i) => {
            const batch = Math.floor(i / 32), row = Math.floor(i % 32 / 8), col = i % 8;
            return BigInt((batch * 4 + row) * 64 + (batch * 8 + col) % 64);
        }),
    },
    {
        name: 'column-transpose',
        setup: 'A = (0 till 16384) reshape 256 64\nCols = (0 till 64) array',
        programs: { ranked: 'Out = A # Cols rank # 0\nOut', transpose: 'Out = A transpose\nOut' },
        shape: [64, 256], values: Array.from({ length: 16384 }, (_, i) => BigInt(i % 256 * 64 + Math.floor(i / 256))),
    },
    {
        name: 'paired-write',
        setup: 'I = (0 till 256) array\nJ = ((0 till 256) mod 64) array',
        programs: {
            ranked: 'Out = array shape 256 64 fill 0\nOut I J rank 0 0 = 1\nOut',
            loop: 'Out = array shape 256 64 fill 0\nfor K in 0 till 256\n Out K (J K) = 1\nend\nOut',
        },
        shape: [256, 64], values: Array.from({ length: 16384 }, (_, i) => i % 64 === Math.floor(i / 64) % 64 ? 1n : 0n),
    },
];

// Optional third argument: a saved pre-change Euler 597 source file.
// git show REV:demos/euler/597_torpids.ra > /tmp/597-before.ra
// node --expose-gc benchmarks/ranked-address.mjs 7 /tmp/597-before.ra
if (process.argv[3]) cases.push({
    name: 'euler-597', setup: '',
    programs: {
        before: readFileSync(process.argv[3], 'utf8') + '\nAnswer',
        ranked: readFileSync(new URL('../demos/euler/597_torpids.ra', import.meta.url), 'utf8') + '\nAnswer',
    },
    scalar: 0.5001817828,
});

const report = [];
for (const task of cases) {
    const measurements = Object.fromEntries(Object.keys(task.programs).map(mode => [mode, []]));
    for (let round = -2; round < samples; round++) {
        for (const [mode, program] of Object.entries(task.programs)) {
            const runtime = new Interpreter(() => {});
            try {
                runtime.execute('use sequences\n' + task.setup);
                globalThis.gc?.();
                const before = process.memoryUsage().heapUsed;
                const start = performance.now();
                const result = runtime.execute(program);
                const milliseconds = performance.now() - start;
                const heapDelta = process.memoryUsage().heapUsed - before;
                if ('scalar' in task) assert.equal(result, task.scalar);
                else {
                    assert(isRankArray(result));
                    assert.deepEqual(result.shape, task.shape);
                    assert.deepEqual(result.items, task.values);
                }
                if (round >= 0) measurements[mode].push({ milliseconds, heapDelta });
            } finally { runtime.dispose(); }
        }
    }
    report.push({ name: task.name, shape: task.shape, measurements });
}
console.log(JSON.stringify({ node: process.version, samples, gc: !!globalThis.gc, report }, null, 2));
