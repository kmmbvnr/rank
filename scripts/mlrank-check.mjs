import assert from 'node:assert/strict';
import { Interpreter, isRankArray, ramRound } from '../packages/interpreter/out/index.js';
import { runRamGpu } from '../packages/cli/out/ram-gpu.js';

const source = 'use ml\noption X .f16 shape 1 64\nreturn X relu\n';
const timings = [];
const input = Array.from({ length: 64 }, (_, i) => (i - 32) / 7);
input[0] = -65504; input[1] = 65504; input[2] = 2 ** -24; input[3] = 1 + 2 ** -11;
const runtime = new Interpreter(() => {}, {
    loadModule: name => ({ id: name, source }),
    ramGpu: (graph, input) => {
        const start = performance.now();
        const result = runRamGpu({ model: Buffer.from(graph.model).toString('base64'), input });
        assert.equal(result.fullyAccelerated, true);
        timings.push({ ...result, output: undefined, hostMs: performance.now() - start });
        return result.output;
    },
});
runtime.execute('use "hello.ram"');
runtime.variables.set('X', { kind: 'array', shape: [1, 64], items: input });
let maxError = 0;
for (let run = 0; run < 3; run++) {
    const result = runtime.execute('X hello');
    assert.ok(isRankArray(result));
    assert.deepEqual(result.shape, [1, 64]);
    for (let i = 0; i < 64; i++) {
        const expected = Math.max(0, ramRound(input[i], 'f16'));
        maxError = Math.max(maxError, Math.abs(result.items[i] - expected));
        assert.ok(Math.abs(result.items[i] - expected) <= 1e-4, `cell ${i}: ${result.items[i]} != ${expected}`);
    }
}
runtime.dispose();
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, maxError, timings }, null, 2));
