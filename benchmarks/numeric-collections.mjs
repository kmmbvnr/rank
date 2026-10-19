// Build first: npx tsc -b tsconfig.build.json
// Optional baseline: --baseline=/absolute/path/to/interpreter/out/index.js
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const candidate = fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url));
const operations = {
    sort: ['B = A sort', 5000000],
    unique: ['B = A unique', 5000000],
    'unique-count': ['Count = A unique len', 5000000],
    argsort: ['B = A argsort', 5000000],
    find: ['Count = A 0 find', 5000000],
    'find-many': ['Q = (99900 to 99963 array) * 7919 mod 1000003\nB = A Q find copy', 100000],
};
if (option('worker', '')) {
    const operation = option('worker', ''), modulePath = option('module', candidate);
    const { Interpreter } = await import(pathToFileURL(modulePath));
    const { RuntimeDiagnostics } = await import(pathToFileURL(resolve(dirname(modulePath), 'diagnostics.js')));
    const { readArrayItem } = await import(pathToFileURL(resolve(dirname(modulePath), 'array-storage.js')));
    const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
    const [source, size] = operations[operation];
    const before = performance.now();
    runtime.execute(`use sequences\nA = (1 to ${size} array) * 7919 mod 1000003`);
    const built = performance.now();
    diagnostics.run(() => runtime.execute(source));
    const done = performance.now();
    const result = runtime.variables.get('B');
    if (operation === 'unique-count') assert.equal(runtime.variables.get('Count'), 1000003n);
    else if (operation === 'find') assert.equal(runtime.variables.get('Count'), 1000002n);
    else {
        assert.equal(result.shape[0], operation === 'unique' ? 1000003 : operation === 'find-many' ? 64 : size);
        if (operation === 'unique') {
            for (let i = 0; i < result.shape[0]; i++) assert.equal(readArrayItem(result, i), BigInt(((i + 1) * 7919) % 1000003));
        } else if (operation === 'sort') {
            const counts = new Uint32Array(1000003);
            for (let i = 1; i <= size; i++) counts[(i * 7919) % 1000003]++;
            let position = 0;
            for (let value = 0; value < counts.length; value++) for (let j = 0; j < counts[value]; j++) {
                assert.equal(readArrayItem(result, position++), BigInt(value));
            }
        } else if (operation === 'argsort') {
            let previous = -1, previousPosition = -1;
            const used = new Uint8Array(size);
            for (let i = 0; i < size; i++) {
                const position = Number(readArrayItem(result, i)), value = ((position + 1) * 7919) % 1000003;
                assert.equal(used[position], 0); used[position] = 1;
                assert.ok(value > previous || value === previous && position > previousPosition);
                previous = value; previousPosition = position;
            }
        } else for (let i = 0; i < 64; i++) assert.equal(readArrayItem(result, i), BigInt(99899 + i));
    }
    const number = name => diagnostics[name] ?? 0;
    const optimized = resolve(modulePath) === candidate;
    if (optimized) {
        assert.ok(operation === 'sort' || operation === 'argsort' ? number('numericSorts') > 0
            : operation.startsWith('unique') ? number('numericDistincts') > 0 : number('numericSearches') > 0);
        if (operation === 'find-many') assert.equal(number('numericSearchIndexes'), 1);
    }
    console.log(JSON.stringify({ operation, size, constructionMs: built - before, operationMs: done - built, startupMs: before, executionColdMs: done, validationMs: performance.now() - done,
        numericSorts: number('numericSorts'), numericDistincts: number('numericDistincts'),
        numericSearches: number('numericSearches'), numericSearchIndexes: number('numericSearchIndexes') }));
    runtime.dispose();
} else {
    const trials = Number(option('trials', '3'));
    assert.ok(Number.isInteger(trials) && trials > 0);
    const cases = option('cases', Object.keys(operations).join(',')).split(',');
    assert.ok(cases.every(name => name in operations));
    console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
        candidateCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), trials }));
    for (const [label, modulePath] of [['candidate', candidate], ['baseline', option('baseline', '')]]) {
        if (!modulePath) continue;
        for (const operation of cases) for (let trial = 0; trial < trials; trial++) {
            const start = performance.now();
            const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${operation}`, `--module=${modulePath}`], { encoding: 'utf8' });
            const processMs = performance.now() - start;
            assert.equal(run.status, 0, run.stderr || run.error?.message);
            const result = JSON.parse(run.stdout.trim());
            console.log(JSON.stringify({ label, trial, ...result, processMs }));
        }
    }
}
