import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics, parse } from '../packages/interpreter/out/index.js';

// Run before and after a scope migration with the same runtime build.
// Parsing, declarations and prime-graph construction are outside the timer.
const sourceRef = process.argv[2];
const read = (path, legacyPath) => {
    if (!sourceRef) return readFileSync(path, 'utf8');
    try { return execFileSync('git', ['show', `${sourceRef}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) {
        if (!legacyPath) throw error;
        return execFileSync('git', ['show', `${sourceRef}:${legacyPath}`], { encoding: 'utf8' });
    }
};
const cases = [
    { name: 'queens_recursive', path: 'demos/classic/queens_recursive.ra', entry: 'solve', args: [8n] },
    { name: 'prime_pair_search', path: 'benchmarks/fixtures/euler060-graph.ra', legacyPath: 'demos/euler/060_primepairs.ra', entry: 'min_five' },
];
const results = [];
for (const item of cases) {
    const source = read(item.path, item.legacyPath);
    const program = parse(source);
    for (const compilation of [false, true]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram({ ...program, statements: program.statements.filter(node =>
                ['UseStatement', 'FunctionStatement'].includes(node.$type)) });
            const args = item.args ?? [runtime.variables.get('build').call([10000n]), 50000n];
            const fn = runtime.variables.get(item.entry);
            const samples = [];
            let expected;
            for (let run = 0; run < 4; run++) {
                const stats = new RuntimeDiagnostics();
                const start = performance.now();
                const value = stats.run(() => fn.call(args));
                const ms = performance.now() - start;
                const representation = typeof value === 'bigint' ? String(value)
                    : JSON.stringify({ shape: value.shape, items: value.items }, (_, cell) => typeof cell === 'bigint' ? String(cell) : cell);
                if (item.name === 'queens_recursive') assert.deepEqual(value.shape, [92, 8]);
                else assert.equal(value, 26033n);
                expected ??= representation;
                assert.equal(representation, expected);
                if (run > 0) samples.push({ ms, copies: stats.cowCopies, cells: stats.cowCopiedCells });
            }
            const result = { name: item.name, compilation, samples,
                medianMs: samples.map(sample => sample.ms).sort((a, b) => a - b)[1],
                outputHash: createHash('sha256').update(expected).digest('hex'),
                sourceHash: createHash('sha256').update(source).digest('hex') };
            results.push(result);
            console.error(JSON.stringify(result));
        } finally { runtime.dispose(); }
    }
}
console.log(JSON.stringify({ node: process.version, sourceRef: sourceRef ?? 'working tree',
    method: 'One warmup and three measured calls per case/mode; declarations and prime graph construction excluded; ordered queens output and prime result checked on every call.', results }, null, 2));
