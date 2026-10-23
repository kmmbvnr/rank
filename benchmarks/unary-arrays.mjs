// Build first: npm run build. Each sample uses a fresh process.
// Compare another checkout with --baseline=/absolute/path/packages/interpreter/out/index.js.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const option = (name, fallback) => process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const candidate = fileURLToPath(new URL('../packages/interpreter/out/index.js', import.meta.url));
const operations = {
    sqrt: ['X sqrt', Math.sqrt], abs: ['X abs', Math.abs],
    floor: ['X floor', value => BigInt(Math.floor(value))],
    ceil: ['X ceil', value => BigInt(Math.ceil(value))],
    isqrt: ['A isqrt', value => BigInt(Math.floor(Math.sqrt(value)))],
    exp: ['X exp', Math.exp], log: ['X log', Math.log], power: ['X ** 0.5', value => value ** 0.5],
};
const size = Number(option('size', '10000000'));
assert.ok(Number.isSafeInteger(size) && size > 0);
const worker = option('worker', '');
if (worker) {
    const modulePath = option('module', candidate);
    const { Interpreter } = await import(pathToFileURL(modulePath));
    const { readArrayItem } = await import(pathToFileURL(resolve(dirname(modulePath), 'array-storage.js')));
    const runtime = new Interpreter();
    try {
        const before = performance.now();
        runtime.execute(`use sequences\nuse numbers\nA = (0 till ${size}) copy\nX = A * 0.5 + 1.0\nZ = X sum`);
        const prepared = performance.now();
        runtime.execute(`C = ${operations[worker][0]}`);
        const mapped = performance.now();
        runtime.execute('Z += C sum');
        const done = performance.now();
        const result = runtime.variables.get('C');
        assert.deepEqual(result.shape, [size]);
        const oracle = operations[worker][1];
        for (let sample = 0; sample < Math.min(size, 129); sample++) {
            const index = Math.floor(sample * (size - 1) / (Math.min(size, 129) - 1 || 1));
            assert.equal(readArrayItem(result, index), oracle(worker === 'isqrt' ? index : index * 0.5 + 1));
        }
        let sum = 0;
        for (let i = 0; i < size; i++) sum += Number(oracle(worker === 'isqrt' ? i : i * 0.5 + 1));
        const expected = size * (size - 1) / 4 + size + sum;
        const checksum = runtime.variables.get('Z');
        assert.ok(checksum === expected || Math.abs(checksum - expected) <= Math.abs(expected) * 1e-12);
        console.log(JSON.stringify({ operation: worker, size, constructionMs: prepared - before,
            mapMs: mapped - prepared, sumMs: done - mapped, operationMs: done - prepared,
            checksum: String(checksum), validationMs: performance.now() - done }));
    } finally { runtime.dispose(); }
} else {
    const trials = Number(option('trials', '3'));
    assert.ok(Number.isInteger(trials) && trials > 0);
    const cases = option('cases', Object.keys(operations).join(',')).split(',');
    assert.ok(cases.every(name => name in operations));
    console.log(JSON.stringify({ node: process.version, cpu: (await import('node:os')).cpus()[0]?.model, trials, size }));
    const modules = [['baseline', option('baseline', '')], ['candidate', candidate]].filter(([, modulePath]) => modulePath);
    for (const operation of cases) {
        const samples = new Map(modules.map(([label]) => [label, []]));
        for (let trial = 0; trial < trials; trial++) {
            for (const [label, modulePath] of modules) {
                const result = spawnSync(process.execPath, [import.meta.filename, `--worker=${operation}`, `--module=${modulePath}`, `--size=${size}`], { encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr || result.error?.message);
                const row = JSON.parse(result.stdout);
                samples.get(label).push(row.operationMs);
                console.log(JSON.stringify({ label, trial, ...row }));
            }
        }
        for (const [label, values] of samples) console.log(JSON.stringify({ label, operation,
            medianMs: values.sort((a, b) => a - b)[Math.floor(values.length / 2)] }));
    }
}
