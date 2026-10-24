// Build both checkouts first. Each sample runs in a fresh process.
// node benchmarks/numeric-array-operands.mjs --root /path/to/checkout --case copy
// Cases: copy, kinds, gather, matmul, euler519. Timings exclude operand construction
// except euler519, which measures the complete default-input program.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const { values } = parseArgs({ options: {
    root: { type: 'string', default: resolve(import.meta.dirname, '..') },
    case: { type: 'string', default: 'copy' },
    samples: { type: 'string', default: '3' },
    worker: { type: 'boolean', default: false },
} });
const root = resolve(values.root), name = values.case, samples = Number(values.samples);
assert(['copy', 'kinds', 'gather', 'matmul', 'euler519'].includes(name));
assert(Number.isSafeInteger(samples) && samples > 0);
if (!values.worker) {
    const runs = [];
    for (let i = 0; i < samples; i++) {
        const child = spawnSync(process.execPath, [import.meta.filename, '--worker', '--root', root, '--case', name], { encoding: 'utf8' });
        assert.equal(child.status, 0, child.stderr || child.stdout);
        runs.push(JSON.parse(child.stdout));
    }
    const medianMs = Object.fromEntries(Object.keys(runs[0]).map(key => {
        const times = runs.map(run => run[key].ms).sort((a, b) => a - b);
        return [key, times[Math.floor(times.length / 2)]];
    }));
    console.log(JSON.stringify({ case: name, root, node: process.version, cpu: cpus()[0].model, medianMs, runs }, null, 2));
} else {
    const load = file => import(pathToFileURL(resolve(root, 'packages/interpreter/out', file)));
    const { Interpreter, RuntimeDiagnostics } = await load('index.js');
    const { integer32Cells, typedArray, storedScalarKinds, readArrayItem } = await load('array-storage.js');
    const { arrayElementTypes } = await load('array-element-types.js');
    const results = {};
    const measure = (label, operation) => {
        const diagnostics = new RuntimeDiagnostics(), start = performance.now();
        const result = diagnostics.run(operation);
        results[label] = { ms: performance.now() - start,
            scannedCells: diagnostics.elementTypeScannedCells,
            unpackedCells: diagnostics.typedUnpackedCells, computedCells: diagnostics.cellsComputed };
        return result;
    };
    if (name === 'copy') {
        const runtime = new Interpreter();
        try {
            runtime.execute('use sequences\nX = (0 till 10000000) copy\nY = X * 1.0\nCi = 0\nCr = 0.0');
            for (const [label, source, check, expected] of [['integer', 'X', 'Ci', 99999980n], ['real', 'Y', 'Cr', 99999980]]) {
                const result = measure(label, () => runtime.execute(`for R in 1 to 20
 A = (${source} (0 till 5000000)) copy
 ${check} += A 0 + A 4999999
end
${check}`));
                assert.equal(result, expected);
            }
        } finally { runtime.dispose(); }
    } else if (name === 'kinds') {
        for (const kind of ['integer', 'real', 'infinity']) {
            const array = typedArray(kind === 'integer' ? new Int32Array(5000000).fill(7)
                : new Float64Array(5000000).fill(kind === 'infinity' ? Infinity : 7));
            measure(kind, () => storedScalarKinds(array));
            assert.deepEqual(arrayElementTypes(array), [kind === 'integer' ? 'integer' : 'real']);
            assert.deepEqual(arrayElementTypes(array, true), [kind === 'integer' ? 'integer' : kind === 'infinity' ? 'numeric-limit' : 'real']);
        }
    } else if (name === 'gather') {
        const runtime = new Interpreter();
        runtime.variables.set('X', typedArray(Int32Array.from({ length: 20000 }, (_, i) => i - 10000)));
        runtime.variables.set('Ix', typedArray(Int32Array.from({ length: 1000000 }, (_, i) => i % 20000)));
        try {
            const result = measure('gather', () => runtime.execute('X Ix'));
            assert.deepEqual(result.shape, [1000000]);
            for (let i = 0; i < 1000000; i++) assert.equal(readArrayItem(result, i), BigInt(i % 20000 - 10000));
            results.gather.storageBytes = 1000000 * (integer32Cells(result) ? 4 : 8);
        } finally { runtime.dispose(); }
    } else if (name === 'matmul') {
        for (const path of ['view', 'copy']) {
            const runtime = new Interpreter();
            runtime.variables.set('K', typedArray(new Int32Array(20500 * 500).fill(7), [20500, 500]));
            runtime.variables.set('Tm', typedArray(new Int32Array(2 * 10000).fill(3), [2, 10000]));
            try {
                runtime.execute('use sequences\nuse linalg');
                const result = measure(path, () => runtime.execute(path === 'view'
                    ? 'Z = Tm matmul (K (0 till 10000))\nZ'
                    : 'Ks = (K (0 till 10000)) copy\nZ = Tm matmul Ks\nZ'));
                assert.deepEqual(result.shape, [2, 500]);
                for (let i = 0; i < 1000; i++) assert.equal(readArrayItem(result, i), 210000n);
            } finally { runtime.dispose(); }
        }
    } else {
        const output = [], runtime = new Interpreter(line => output.push(line));
        try {
            const source = readFileSync(resolve(root, 'demos/euler/519_tricolouredcoin.ra'), 'utf8');
            measure('default', () => runtime.execute(source));
            assert.deepEqual(output, ['804739330']);
        } finally { runtime.dispose(); }
    }
    console.log(JSON.stringify(results));
}
