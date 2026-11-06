import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { Interpreter, isRankArray } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const { typedArray, readArrayItem } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const { matmulValues } = await import(pathToFileURL(`${root}/packages/interpreter/out/modules/linalg.js`));
const mode = process.argv[2] ?? 'sparse', rows = 9, inner = 9, columns = 10110, size = 1048576;
const runtime = new Interpreter(() => {}, { numberLoopCompilation: false });
try {
    let run, expected;
    if (mode === 'tensor') {
        const a = BigInt64Array.from({ length: size }, (_, i) => 4294967295n + BigInt(i));
        const b = BigInt64Array.from({ length: size }, (_, i) => 4294967296n + BigInt(i));
        runtime.variables.set('A', typedArray(a)); runtime.variables.set('B', typedArray(b));
        runtime.execute('0');
        run = () => runtime.execute('Saved = (A + B) mod 1000000007\nSaved');
        expected = i => (a[i] + b[i]) % 1000000007n;
    } else {
        const left = Array.from({ length: rows * inner }, (_, i) => mode === 'sparse'
            ? Number(Math.floor(i / inner) % 3 === 0 && i % inner % 3 === 0) : 1);
        const right = Array.from({ length: inner * columns }, (_, i) => (i * 7919) % 1000000007);
        const pack = values => mode === 'real' ? Float64Array.from(values) : Int32Array.from(values);
        const a = typedArray(pack(left), [rows, inner]), b = typedArray(pack(right), [inner, columns]);
        run = () => matmulValues(a, b);
        expected = i => {
            const row = Math.floor(i / columns), column = i % columns;
            if (mode === 'real') {
                let sum = 0;
                for (let k = 0; k < inner; k++) sum += left[row * inner + k] * right[k * columns + column];
                return sum;
            }
            let sum = 0n;
            for (let k = 0; k < inner; k++) sum += BigInt(left[row * inner + k]) * BigInt(right[k * columns + column]);
            return sum;
        };
    }
    const cpu = process.cpuUsage(), start = performance.now(), result = run();
    const ms = performance.now() - start, used = process.cpuUsage(cpu), maxRssMiB = process.resourceUsage().maxRSS / 1024;
    assert(result && isRankArray(result));
    for (let i = 0; i < (mode === 'tensor' ? size : rows * columns); i++) assert.equal(readArrayItem(result, i), expected(i));
    console.log(JSON.stringify({ mode, ms, cpuMs: (used.user + used.system) / 1000,
        maxRssMiB, node: process.version, arch: process.arch }));
} finally { runtime.dispose(); }
