import assert from 'node:assert/strict';
import { Interpreter, isRankArray } from '../packages/interpreter/out/index.js';
import { runRamGpu } from '../packages/cli/out/ram-gpu.js';

const checks = [];
for (const precision of ['f16', 'f32']) for (const shape of [[8], [1, 64], [16, 256], [1, 2, 8, 16]]) {
    const size = shape.reduce((a, b) => a * b, 1);
    // f16 values here are exactly representable. f32 values expose unintended FP16 execution.
    const input = Array.from({ length: size }, (_, i) => precision === 'f16'
        ? (i % 2048 - 1024) / 8 : Math.fround((i - size / 2) / 7));
    const source = `use ml\noption X .${precision} shape ${shape.join(' ')}\nreturn X relu\n`;
    const reference = new Interpreter(() => {});
    reference.execute('use ml');
    reference.variables.set('X', { kind: 'array', shape, items: input });
    const expected = reference.execute('X relu');
    assert.ok(isRankArray(expected));
    const timings = [];
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
    runtime.variables.set('X', { kind: 'array', shape, items: input });
    let maxError = 0;
    for (let run = 0; run < 2; run++) {
        const result = runtime.execute('X hello');
        assert.ok(isRankArray(result));
        assert.deepEqual(result.shape, shape);
        for (let i = 0; i < size; i++) {
            const error = Math.abs(result.items[i] - expected.items[i]);
            maxError = Math.max(maxError, error);
            assert.ok(error <= 1e-4, `${precision} ${shape} cell ${i}: ${result.items[i]} != ${expected.items[i]}`);
        }
    }
    checks.push({ precision, shape, maxError, timings });
    runtime.dispose(); reference.dispose();
}
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, checks }, null, 2));
