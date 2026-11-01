import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';
import { typedArray, readArrayItem } from '../packages/interpreter/out/array-storage.js';

const rows = Number(process.argv[2] ?? 600), columns = Number(process.argv[3] ?? 800);
const mode = process.argv[4];
assert(Number.isSafeInteger(rows) && rows > 0 && Number.isSafeInteger(columns) && columns > 0);
if (!mode) {
    const results = ['direct', 'generic', 'native', 'materialized'].map(mode => {
        const child = spawnSync(process.execPath, ['--expose-gc', import.meta.filename, String(rows), String(columns), mode], { encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr);
        return JSON.parse(child.stdout);
    });
    console.log(JSON.stringify({ cpu: cpus()[0]?.model, node: process.version, rows, columns,
        memory: 'each mode in a fresh process; absolute process peak RSS includes runtime and input preparation', results }, null, 2));
} else {
    const a = BigInt64Array.from({ length: rows }, (_, i) => BigInt(i % 7 - 3));
    const b = BigInt64Array.from({ length: columns }, (_, i) => BigInt(i % 5 - 2));
    const direct = () => {
        const result = Array(rows + columns - 1).fill(0n);
        for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) result[i + j] += a[i] * b[j];
        return result;
    };
    const expected = direct();
    const runtime = new Interpreter(() => {}, { compilation: mode !== 'generic' });
    try {
        runtime.variables.set('A', typedArray(a));
        runtime.variables.set('B', typedArray(b));
        runtime.variables.set('I', typedArray(Int32Array.from(a, (_, i) => i)));
        runtime.variables.set('J', typedArray(Int32Array.from(b, (_, i) => i)));
        const expression = mode === 'materialized'
            ? 'O = A B outer *\nK = I J outer +\nO reduce + by K'
            : '(A B outer *) reduce + by (I J outer +)';
        const program = runtime.parse(expression);
        const times = [];
        global.gc?.();
        const before = process.memoryUsage();
        for (let sample = 0; sample < 3; sample++) {
            const start = performance.now();
            const result = mode === 'direct' ? direct() : runtime.executeProgram(program);
            times.push(performance.now() - start);
            if (mode === 'direct') assert.deepEqual(result, expected);
            else {
                assert(isRankArray(result));
                assert.equal(result.shape[0], expected.length);
                for (let i = 0; i < expected.length; i++) assert.equal(readArrayItem(result, i), expected[i]);
            }
        }
        const after = process.memoryUsage();
        console.log(JSON.stringify({ mode, samplesMs: times, medianMs: [...times].sort((a, b) => a - b)[1],
            peakRssKiB: process.resourceUsage().maxRSS, before, after }));
    } finally { runtime.dispose(); }
}
