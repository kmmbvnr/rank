import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Run against another built checkout with --runtime=/path/to/checkout.
const options = process.argv.slice(2);
const option = (name, fallback) => options.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
for (const value of options) assert(/^--(size|samples|runtime)=/.test(value), `Unknown option: ${value}`);
const size = Number(option('size', 2772));
const samples = Number(option('samples', 3));
assert(Number.isSafeInteger(size) && size > 0);
assert(Number.isSafeInteger(samples) && samples > 0);
const root = option('runtime', fileURLToPath(new URL('..', import.meta.url)));
const runtimeUrl = pathToFileURL(resolve(root, 'packages/interpreter/out') + '/');
const { Interpreter } = await import(new URL('index.js', runtimeUrl));
const { typedArray, integer32Cells } = await import(new URL('owned-array.js', runtimeUrl));
const { materializeValue } = await import(new URL('materialize.js', runtimeUrl));
const width = 2 * size - 1;
const data = Int32Array.from({ length: size * size }, (_, index) =>
    (Math.floor(index / size) * 1000003 + index % size * 1000033) % 1073741824);
const expected = Array(width).fill(0n);
for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    expected[row + column] += BigInt(data[row * size + column]);
}
const results = [];
for (let sample = 0; sample < samples; sample++) {
    const runtime = new Interpreter();
    try {
        runtime.execute('use numbers\nuse sequences');
        runtime.variables.set('R', BigInt(size));
        runtime.variables.set('W', BigInt(width));
        runtime.variables.set('Op', typedArray(data.slice(), [size, size]));
        const timings = {};
        const measure = (name, source) => {
            global.gc?.();
            const start = performance.now();
            runtime.execute(source);
            const binding = source.split(' = ')[0];
            const value = materializeValue(runtime.variables.get(binding));
            runtime.variables.set(binding, value);
            timings[name] = performance.now() - start;
            return value;
        };
        measure('paddingMs', 'Zr = array shape R R fill 0');
        measure('concatAxis1Ms', 'Pd = concat Op Zr axis 1');
        measure('firstReshapeMs', 'Pf = Pd reshape (2 * R * R)');
        measure('concatPaddingMs', 'Fl = concat Pf (array shape ((R + 1) * W - 2 * R * R) fill 0)');
        const matrix = measure('secondReshapeMs', 'Mx = Fl reshape (R + 1) W');
        assert(integer32Cells(matrix), 'the fixture must retain packed integer storage');
        const result = measure('reduceAxis0Ms', 'Cv = Mx reduce + axis 0');
        assert.deepEqual(result.shape, [width]);
        assert.deepEqual([...result.items], expected);
        results.push({ ...timings, preparationMs: timings.concatAxis1Ms + timings.firstReshapeMs
            + timings.concatPaddingMs + timings.secondReshapeMs });
    } finally { runtime.dispose(); }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, size, samples,
    inputCells: size * size, reducedCells: (size + 1) * width, correct: true,
    medianMs: Object.fromEntries(Object.keys(results[0]).map(key => [key, median(results.map(result => result[key]))])), results }, null, 2));
