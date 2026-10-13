import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Interpreter, parse } from '../packages/interpreter/out/index.js';

// npx tsc -b tsconfig.build.json && node benchmarks/queens-languages.mjs
const root = fileURLToPath(new URL('..', import.meta.url));
const algorithms = ['permutations', 'prefixes'];
const sources = Object.fromEntries(algorithms.map(name => [name, readFileSync(new URL(
    `../demos/classic/${name === 'prefixes' ? 'queens' : 'queens_permutations'}.ra`, import.meta.url), 'utf8')]));
const oracle = [];
function visit(q) {
    if (q.length === 8) { oracle.push(q); return; }
    for (let col = 0; col < 8; col++) {
        if (q.every((old, i) => old !== col && Math.abs(old - col) !== q.length - i)) visit([...q, col]);
    }
}
visit([]);
assert.equal(oracle.length, 92);
const worker = process.argv.find(arg => arg.startsWith('--worker='))?.slice(9);
if (worker) {
    assert(algorithms.includes(worker));
    const source = sources[worker];
    const outputStart = source.indexOf(worker === 'prefixes' ? 'States len print' : 'Sols len print');
    const helpers = source.indexOf('\nfun ');
    assert(outputStart >= 0 && helpers > outputStart);
    const program = parse(source.slice(0, outputStart) + source.slice(helpers));
    const setupStatements = program.statements.filter(s => ['UseStatement', 'FunctionStatement'].includes(s.$type));
    const solveStatements = program.statements.filter(s => !setupStatements.includes(s));
    const run = () => {
        const runtime = new Interpreter(() => {}, {
            arrayFunctionCompilation: process.env.RANK_ARRAY_COMPILATION !== 'false',
            rankedArrayCompilation: process.env.RANK_RANKED_ARRAY_COMPILATION !== 'false',
        });
        runtime.executeProgram({ ...program, statements: setupStatements });
        const start = performance.now();
        runtime.executeProgram({ ...program, statements: solveStatements });
        const ms = performance.now() - start;
        const value = runtime.variables.get(worker === 'prefixes' ? 'States' : 'Sols');
        assert.deepEqual(value.shape, [92, 8]);
        const solutions = Array.from({ length: 92 }, (_, row) => Array.from({ length: 8 }, (_, col) =>
            Number(value.itemAt?.(row * 8 + col) ?? value.items[row * 8 + col])));
        assert.deepEqual(solutions, oracle);
        runtime.dispose();
        return { ms, solutions };
    };
    const warm = run();
    const iterations = Math.min(1000, Math.max(1, Math.ceil(200 / Math.max(warm.ms, 0.1))));
    let totalMs = 0, last;
    for (let i = 0; i < iterations; i++) { last = run(); totalMs += last.ms; }
    console.log(JSON.stringify({ ms: totalMs / iterations, iterations, checksum: 92 * iterations,
        solutions: last.solutions, version: process.version }));
} else {
    const samples = Number(process.env.SAMPLES ?? 5);
    assert(Number.isSafeInteger(samples) && samples > 0);
    const runtimes = {
        Rank: [process.execPath, fileURLToPath(import.meta.url)],
        TypeScript: [process.execPath, `${root}/benchmarks/queens-languages/queens.ts`],
        Python: [process.env.PYTHON ?? 'python3', `${root}/benchmarks/queens-languages/queens.py`],
        Ruby: [process.env.RUBY ?? 'ruby', `${root}/benchmarks/queens-languages/queens.rb`],
    };
    const cells = Object.keys(runtimes).flatMap(runtime => algorithms.map(algorithm => ({ runtime, algorithm })));
    const result = { cpu: cpus()[0].model, platform: `${process.platform}/${process.arch}`, samples,
        method: 'Fresh process per sample, one warmup, calibrated batch targeting 200 ms, normalized per solve. Parsing, startup, imports and printing excluded; complete solutions retained. Every returned result matches an independent ordered oracle of 92 boards. Both algorithms use the same representations: full permutation rows, or full-width state rows plus blocked-column membership and flat parent/column indices.',
        notes: 'Standard libraries only. Python itertools.permutations and Ruby Array#permutation are native builtins; TypeScript uses a recursive generator. TypeScript uses number for these exact small integers; Rank uses integer values. No NumPy or specialized bitboard search.',
        sourceHashes: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, createHash('sha256').update(v).digest('hex')])),
        results: {} };
    for (let sample = 0; sample < samples; sample++) {
        const offset = sample % cells.length;
        for (const { runtime, algorithm } of [...cells.slice(offset), ...cells.slice(0, offset)]) {
            const [command, ...args] = runtimes[runtime];
            const child = spawnSync(command, [...args, runtime === 'Rank' ? `--worker=${algorithm}` : algorithm],
                { encoding: 'utf8', cwd: root, timeout: 120000 });
            assert.equal(child.status, 0, `${runtime}/${algorithm}: ${child.stderr ?? child.error}`);
            const measured = JSON.parse(child.stdout);
            assert.deepEqual(measured.solutions, oracle, `${runtime}/${algorithm}`);
            assert.equal(measured.checksum, 92 * measured.iterations);
            const entry = (result.results[runtime] ??= { version: measured.version, algorithms: {} });
            (entry.algorithms[algorithm] ??= { runs: [] }).runs.push({ ms: measured.ms, iterations: measured.iterations });
            console.error(`${runtime}/${algorithm} ${sample + 1}/${samples}: ${measured.ms.toFixed(3)} ms`);
        }
    }
    for (const runtime of Object.values(result.results)) for (const value of Object.values(runtime.algorithms)) {
        value.medianMs = value.runs.map(run => run.ms).sort((a, b) => a - b)[Math.floor(samples / 2)];
    }
    console.log(JSON.stringify(result, null, 2));
}
