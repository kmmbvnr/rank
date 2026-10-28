import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Interpreter, compileRam, isRankArray } from '../packages/interpreter/out/index.js';
import { runRamGpu } from '../packages/cli/out/ram-gpu.js';

// Nonuniform weights expose incorrect transposition; odd dimensions expose padding bugs.
function linearFixtures() {
    return [[1, 64, 128], [3, 5, 7], [4, 17, 3], [1, 3, 16385]].flatMap(([m, k, n]) => [0, 1].map(change => {
        const input = Array.from({ length: m * k }, (_, i) => Math.fround((i % 19 - 9) / 11));
        const weights = Array.from({ length: k * n }, (_, i) => Math.fround(((i * 7 + change) % 23 - 11) / 13));
        const literals = weights.map(x => Number.isInteger(x) ? x.toFixed(1) : String(x)).join(' ');
        const source = `use ml\narg X .f32 shape ${m} ${k}\narg W .f32 shape ${k} ${n} = array ${literals} shape ${k} ${n}\nreturn (X W linear) relu\n`;
        const graph = compileRam(source, 'dense.ram').graph;
        const reference = new Interpreter(() => {});
        reference.execute('use linalg\nuse ml');
        reference.variables.set('X', { kind: 'array', shape: [m, k], items: input });
        reference.variables.set('W', { kind: 'array', shape: [k, n], items: weights });
        const expected = reference.execute('(X matmul W) relu');
        assert.ok(isRankArray(expected));
        reference.dispose();
        return { m, k, n, change, source, input, expected: expected.items,
            model: Buffer.from(graph.model).toString('base64') };
    }));
}
const fixtures = linearFixtures();
if (process.argv.includes('--android')) {
    mkdirSync('output/playwright', { recursive: true });
    writeFileSync('output/playwright/ram-linear.js', readFileSync('packages/web/test/ram-linear.playwright.js', 'utf8')
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
        runtime.variables.set('X', { kind: 'array', shape: [fixture.m, fixture.k], items: fixture.input });
        let repeat;
        for (repeat = 0; repeat < 2; repeat++) {
            const actual = runtime.execute('X dense');
            assert.ok(isRankArray(actual));
            assert.deepEqual(actual.shape, [fixture.m, fixture.n]);
            let maxError = 0;
            actual.items.forEach((value, i) => {
                const error = Math.abs(value - fixture.expected[i]);
                maxError = Math.max(maxError, error);
                assert.ok(error <= 1e-5 + 1e-5 * Math.abs(fixture.expected[i]), `cell ${i}: ${value} != ${fixture.expected[i]}`);
            });
            checks.push({ shape: [fixture.m, fixture.k, fixture.n], change: fixture.change, repeat, maxError });
        }
        runtime.dispose();
    }
    console.log(JSON.stringify({ platform: process.platform, checks }, null, 2));
}
