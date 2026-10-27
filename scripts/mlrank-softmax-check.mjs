import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Interpreter, compileRam, isRankArray } from '../packages/interpreter/out/index.js';
import { runRamGpu } from '../packages/cli/out/ram-gpu.js';

function softmax(values, width) {
    return values.flatMap((_, offset) => {
        if (offset % width) return [];
        const row = values.slice(offset, offset + width);
        const max = Math.max(...row);
        const exp = row.map(x => Math.exp(x - max));
        const sum = exp.reduce((a, b) => a + b, 0);
        return exp.map(x => x / sum);
    });
}
function softmaxFixtures() {
    return [[5], [2, 5], [2, 3, 5], [2, 2, 3, 5], [3, 1]].flatMap(shape =>
        ['extreme', 'equal', 'mixed'].flatMap(pattern => ['alias', 'reuse'].map(op => {
            const input = Array.from({ length: shape.reduce((a, b) => a * b) }, (_, i) =>
                pattern === 'equal' ? 10000 : pattern === 'extreme'
                    ? (Math.floor(i / shape.at(-1)) % 2 ? -10000 : 10000) + i % shape.at(-1)
                    : Math.fround((i % 13 - 6) * 7.3));
            const body = op === 'alias' ? 'Old = X\nX = X relu\nreturn Old softmax'
                : 'H = X softmax\nOld = H\nH = H relu\nreturn (Old + H) softmax';
            const source = `use ml\noption X .f32 shape ${shape.join(' ')}\n${body}\n`;
            const graph = compileRam(source, 'dense.ram').graph;
            const first = softmax(input, shape.at(-1));
            const expected = op === 'alias' ? first : softmax(first.map(x => Math.fround(Math.fround(x) * 2)), shape.at(-1));
            return { shape, op: pattern + '/' + op, outputShape: shape, source, input, expected,
                model: Buffer.from(graph.model).toString('base64') };
        })));
}
const fixtures = softmaxFixtures();
if (process.argv.includes('--android')) {
    mkdirSync('output/playwright', { recursive: true });
    writeFileSync('output/playwright/ram-softmax.js', readFileSync('packages/web/test/ram-softmax.playwright.js', 'utf8')
        .replace('__RAM_FIXTURES__', JSON.stringify(fixtures.map(({ source, ...fixture }) => fixture))));
} else {
    const checks = [];
    let previousModel;
    for (const fixture of fixtures) {
        const source = fixture.source;
        const runtime = new Interpreter(() => {}, {
            loadModule: name => ({ id: name, source }),
            ramGpu: (graph, input) => {
                const result = runRamGpu({ model: Buffer.from(graph.model).toString('base64'), input,
                    outputSize: graph.outputShape.reduce((a, b) => a * b, 1) });
                assert.equal(result.fullyAccelerated, true);
                assert.equal(result.cached, previousModel === fixture.model);
                previousModel = fixture.model;
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
                assert.ok(error <= 1e-5 + 1e-5 * Math.abs(fixture.expected[i]), `${fixture.shape} ${fixture.op} cell ${i}: ${value} != ${fixture.expected[i]}`);
            });
            const width = fixture.shape.at(-1);
            for (let offset = 0; offset < actual.items.length; offset += width) {
                const sum = actual.items.slice(offset, offset + width).reduce((a, b) => a + b, 0);
                assert.ok(Math.abs(sum - 1) < 1e-5, 'Softmax row must sum to one');
            }
            checks.push({ shape: fixture.shape, op: fixture.op, repeat, maxError });
        }
        runtime.dispose();
    }
    console.log(JSON.stringify({ platform: process.platform, checks }, null, 2));
}
