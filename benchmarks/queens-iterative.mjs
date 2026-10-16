import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

// npx tsc -b tsconfig.build.json && node benchmarks/queens-iterative.mjs
const { Interpreter, parse } = await import(process.env.RANK_INTERPRETER ?? '../packages/interpreter/out/index.js');
const sources = {
    iterative: readFileSync(new URL('../demos/classic/queens_iterative.ra', import.meta.url), 'utf8')
        .split('\nfor Board in 8 queens')[0],
    batched: readFileSync(new URL('../demos/classic/queens.ra', import.meta.url), 'utf8')
        .split('States len print')[0],
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function oracle(n) {
    const solutions = [];
    function visit(board) {
        if (board.length === n) { solutions.push(board); return; }
        for (let col = 0; col < n; col++) {
            if (board.every((old, row) => old !== col && Math.abs(old - col) !== board.length - row)) {
                visit([...board, col]);
            }
        }
    }
    visit([]);
    return solutions;
}

if (process.argv[2] === '--worker') {
    const [variant, size, mode] = process.argv.slice(3);
    assert(variant in sources);
    const n = Number(size), compilation = mode === 'true';
    const expected = oracle(n);
    const source = variant === 'iterative' ? `${sources.iterative}\n${n} queens array`
        : sources.batched.replace('Size = 8', `Size = ${n}`) + '\nStates copy';
    const program = parse(source);
    const setup = program.statements.filter(s => ['UseStatement', 'FunctionStatement'].includes(s.$type));
    const solve = program.statements.filter(s => !setup.includes(s));
    const times = [];
    for (let run = 0; run < 4; run++) {
        global.gc?.();
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram({ ...program, statements: setup });
            const start = performance.now();
            const result = runtime.executeProgram({ ...program, statements: solve });
            const ms = performance.now() - start;
            assert.deepEqual(result.shape, [expected.length, n]);
            const items = result.items;
            const actual = Array.from({ length: expected.length }, (_, row) =>
                Array.from({ length: n }, (_, col) => Number(items[row * n + col])));
            assert.deepEqual(actual, expected);
            if (run > 0) times.push(ms);
        } finally { runtime.dispose(); }
    }
    console.log(JSON.stringify({ ms: median(times), times, solutions: expected.length }));
} else {
    const samples = Number(process.env.SAMPLES ?? 5);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const results = [];
    for (const n of [8, 9]) for (const compilation of [true, false]) {
        const times = { iterative: [], batched: [] };
        let solutions;
        for (let sample = 0; sample < samples; sample++) {
            for (const variant of sample % 2 ? ['batched', 'iterative'] : ['iterative', 'batched']) {
                const child = spawnSync(process.execPath,
                    ['--expose-gc', fileURLToPath(import.meta.url), '--worker', variant, String(n), String(compilation)],
                    { encoding: 'utf8', timeout: 120_000 });
                assert.equal(child.status, 0, child.stderr || String(child.error));
                const measured = JSON.parse(child.stdout);
                times[variant].push(measured.ms);
                solutions = measured.solutions;
            }
        }
        const row = { n, compilation, solutions, iterativeMs: median(times.iterative),
            batchedMs: median(times.batched), times };
        results.push(row);
        console.error(JSON.stringify(row));
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, samples,
        method: 'Fresh process per sample; one warmup and three measured searches per process; median of medians. Alternate variant order. Parsing, initialization, imports, function declarations, verification and printing excluded. Finding and materializing every solution included. Every run matches an independent ordered oracle.',
        interpreter: process.env.RANK_INTERPRETER ?? 'workspace build',
        sourceHashes: Object.fromEntries(Object.entries(sources).map(([name, source]) =>
            [name, createHash('sha256').update(source).digest('hex')])), results }, null, 2));
}
