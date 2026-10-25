// node benchmarks/ordered-cell-axes.mjs [--runtime=/absolute/path/to/checkout]
// Full-demand timings; deterministic data and an independent covariance oracle.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = process.argv.find(arg => arg.startsWith('--runtime='))?.slice(10);
const base = root ? pathToFileURL(resolve(root) + '/') : new URL('../', import.meta.url);
const { Interpreter } = await import(new URL('packages/interpreter/out/index.js', base));
const { arrayValues, typedArray, derivedArray } = await import(new URL('packages/interpreter/out/array-storage.js', base));
const size = shape => shape.reduce((a, b) => a * b, 1);
const coordinates = (shape, index) => shape.map((_, axis) =>
    Math.floor(index / size(shape.slice(axis + 1))) % shape[axis]);
const offset = (shape, coords) => coords.reduce((n, c, axis) => n * shape[axis] + c, 0);
function oracle(shape, data, axes, correlation) {
    const frameAxes = shape.map((_, i) => i).filter(i => !axes.includes(i));
    const frame = frameAxes.map(i => shape[i]);
    const features = shape[axes[0]], observations = shape[axes[1]];
    const output = [];
    for (let batch = 0; batch < size(frame); batch++) {
        const coords = Array(shape.length).fill(0);
        coordinates(frame, batch).forEach((c, i) => { coords[frameAxes[i]] = c; });
        const rows = Array.from({ length: features }, (_, f) => Array.from({ length: observations }, (_, o) => {
            coords[axes[0]] = f; coords[axes[1]] = o;
            return data[offset(shape, coords)];
        }));
        const means = rows.map(row => row.reduce((a, b) => a + b, 0) / observations);
        const cov = rows.map((row, i) => rows.map((other, j) =>
            row.reduce((total, x, k) => total + (x - means[i]) * (other[k] - means[j]), 0) / (observations - 1)));
        for (let i = 0; i < features; i++) for (let j = 0; j < features; j++) {
            output.push(correlation ? (cov[i][i] <= 0 || cov[j][j] <= 0 ? +(i === j)
                : Math.max(-1, Math.min(1, cov[i][j] / Math.sqrt(cov[i][i] * cov[j][j])))) : cov[i][j]);
        }
    }
    return { shape: [...frame, features, features], output };
}
const results = [];
for (const entry of [
    { name: 'matrix', shape: [16, 256], axes: [0, 1], suffix: '' },
    { name: 'batch', shape: [8, 8, 128], axes: [1, 2], suffix: '' },
    { name: 'batch-rank', shape: [8, 8, 128], axes: [1, 2], suffix: ' rank 2' },
    { name: 'small-batches', shape: [32, 4, 32], axes: [1, 2], suffix: '' },
    { name: 'noncontiguous', shape: [8, 8, 128], axes: [0, 2], suffix: ' axis 0 2' },
    { name: 'ordered', shape: [128, 8, 8], axes: [2, 0], suffix: ' axis 2 0' },
    { name: 'lazy-batch', shape: [8, 8, 128], axes: [1, 2], suffix: '', lazy: true },
]) for (const operation of ['covariance', 'correlation']) {
    const runtime = new Interpreter(); runtime.execute('use stats');
    const data = Float64Array.from({ length: size(entry.shape) }, (_, i) => Math.sin(i * .71) + i % 11);
    runtime.variables.set('Data', entry.lazy ? derivedArray(entry.shape, [], i => data[i], true) : typedArray(data, entry.shape));
    const expected = oracle(entry.shape, data, entry.axes, operation === 'correlation');
    const ms = [];
    for (let round = 0; round < 7; round++) {
        const start = performance.now();
        const result = runtime.execute(`Data ${operation}${entry.suffix}`);
        const actual = [...arrayValues(result)];
        const elapsed = performance.now() - start;
        assert.deepEqual(result.shape, expected.shape);
        assert.deepEqual(actual, expected.output);
        if (round >= 2) ms.push(elapsed);
    }
    results.push({ case: entry.name, operation, shape: entry.shape, ms,
        median: [...ms].sort((a, b) => a - b)[2], checksum: expected.output.reduce((a, b) => a + b, 0) });
    runtime.dispose();
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
