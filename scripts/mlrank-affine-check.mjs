import assert from 'node:assert/strict';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';
import { runRamGpu } from '../packages/cli/out/ram-gpu.js';

let source;
const checks = [];
let lastModel;
const runtime = new Interpreter(() => {}, {
    loadModule: name => ({ id: name, source }),
    ramGpu: (graph, input) => {
        const model = Buffer.from(graph.model).toString('base64');
        const result = runRamGpu({ model, input });
        assert.equal(result.cached, lastModel === model);
        lastModel = model;
        assert.equal(result.fullyAccelerated, true);
        return result.output;
    },
});
const input = Array.from({ length: 4096 }, (_, i) => Math.fround((i - 2048) / 7));
for (const scale of [2, 3]) {
    source = `use ml
arg X .f32 shape 16 256
arg Scale .f32 shape 16 256 = array shape 16 256 fill ${scale}.0
arg Bias .f32 shape 16 256 = array shape 16 256 fill 0.5
return ((X * Scale) + Bias) relu
`;
    if (scale === 2) runtime.execute('use "affine.ram"');
    runtime.variables.set('X', { kind: 'array', shape: [16, 256], items: input });
    const reference = new Interpreter(() => {});
    reference.execute('use ml');
    reference.variables.set('X', { kind: 'array', shape: [16, 256], items: input });
    reference.variables.set('Scale', { kind: 'array', shape: [16, 256], items: input.map(() => scale) });
    reference.variables.set('Bias', { kind: 'array', shape: [16, 256], items: input.map(() => 0.5) });
    const expected = reference.execute('((X * Scale) + Bias) relu');
    assert.ok(isRankArray(expected));
    for (let repeat = 0; repeat < 2; repeat++) {
        const actual = runtime.execute('X affine');
        assert.ok(isRankArray(actual));
        assert.deepEqual(actual.shape, [16, 256]);
        let maxError = 0;
        actual.items.forEach((value, i) => {
            const error = Math.abs(value - expected.items[i]);
            maxError = Math.max(maxError, error);
            assert.ok(error <= 1e-5 + 1e-6 * Math.abs(expected.items[i]), `cell ${i}: ${value} != ${expected.items[i]}`);
        });
        checks.push({ scale, repeat, maxError });
    }
    reference.dispose();
}
runtime.dispose();
console.log(JSON.stringify({ platform: process.platform, checks }, null, 2));
