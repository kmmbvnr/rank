import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Interpreter, compileRam, isRankArray } from '../packages/interpreter/out/index.js';
import { runRamGpu } from '../packages/cli/out/ram-gpu.js';

function broadcastFixtures() {
    return [
        [[2, 3], [2, 3]], [[2, 3], [3]], [[3], [2, 3]], [[2, 1, 3], [1, 4, 1]],
        [[2, 3, 4, 5], [5]], [[2, 3, 4, 5], [1, 3, 1, 5]],
    ].flatMap(([shape, biasShape]) => ['X + B', 'B + X', 'X * B', 'B * X'].map(op => {
        const input = Array.from({ length: shape.reduce((a,b) => a*b) }, (_, i) => Math.fround((i % 19 - 9) / 11));
        const weights = Array.from({ length: biasShape.reduce((a,b) => a*b) }, (_, i) => Math.fround((i % 7 - 3) / 13));
        const literals = weights.map(x => Number.isInteger(x) ? x.toFixed(1) : String(x)).join(' ');
        const source = `use ml\narg X .f32 shape ${shape.join(' ')}\narg B .f32 shape ${biasShape.join(' ')} = array ${literals} shape ${biasShape.join(' ')}\nreturn ${op}\n`;
        const graph = compileRam(source, 'dense.ram').graph;
        const reference = new Interpreter(() => {});
        reference.execute('use ml');
        reference.variables.set('X', { kind: 'array', shape, items: input });
        reference.variables.set('B', { kind: 'array', shape: biasShape, items: weights });
        const expected = reference.execute(op);
        assert.ok(isRankArray(expected));
        assert.deepEqual(graph.outputShape, expected.shape);
        reference.dispose();
        return { shape, biasShape, op, outputShape: expected.shape, source, input, expected: expected.items,
            model: Buffer.from(graph.model).toString('base64') };
    }));
}
const fixtures = broadcastFixtures();
if (process.argv.includes('--android')) {
    mkdirSync('output/playwright', { recursive: true });
    writeFileSync('output/playwright/ram-broadcast.js', readFileSync('packages/web/test/ram-broadcast.playwright.js', 'utf8')
        .replace('__RAM_FIXTURES__', JSON.stringify(fixtures.map(({ source, ...fixture }) => fixture))));
} else {
    const checks = [];
    for (const fixture of fixtures) {
        const source = fixture.source;
        const runtime = new Interpreter(() => {}, {
            loadModule: name => ({ id: name, source }),
            ramGpu: (graph, input) => {
                const result = runRamGpu({ model: Buffer.from(graph.model).toString('base64'), input,
                    outputSize: graph.outputShape.reduce((a, b) => a * b, 1) });
                assert.equal(result.fullyAccelerated, true);
                assert.equal(result.cached, repeat === 1);
                return result.output;
            },
        });
        runtime.execute('use "dense.ram"');
        runtime.variables.set('X', { kind: 'array', shape: fixture.shape, items: fixture.input });
        let repeat;
        for (repeat = 0; repeat < 2; repeat++) {
            const actual = runtime.execute('X dense');
            assert.ok(isRankArray(actual));
            assert.deepEqual(actual.shape, fixture.outputShape);
            let maxError = 0;
            actual.items.forEach((value, i) => {
                const error = Math.abs(value - fixture.expected[i]);
                maxError = Math.max(maxError, error);
                assert.ok(error <= 1e-5 + 1e-5 * Math.abs(fixture.expected[i]), `${fixture.shape}/${fixture.biasShape} ${fixture.op} cell ${i}: ${value} != ${fixture.expected[i]}`);
            });
            checks.push({ shape: fixture.shape, biasShape: fixture.biasShape, op: fixture.op, repeat, maxError });
        }
        runtime.dispose();
    }
    console.log(JSON.stringify({ platform: process.platform, checks }, null, 2));
}
