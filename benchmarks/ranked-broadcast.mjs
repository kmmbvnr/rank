import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Interpreter, createArraySnapshot, demandValue } from '../packages/interpreter/out/index.js';

// Run fresh processes for independent samples:
// node benchmarks/ranked-broadcast.mjs [rows=128] [columns=192] [samples=5]
const [rows, columns, samples] = process.argv.slice(2).map(Number);
const height = rows ?? 128, width = columns ?? 192, count = samples ?? 5;
assert([height, width, count].every(n => Number.isSafeInteger(n) && n > 0));
const input = createArraySnapshot(Array.from({ length: height * width }, (_, i) => ((i * 13) % 79 - 39) / 16),
    [height, width]);
const expected = [];
for (let row = 0; row < height; row++) {
    const values = input.items.slice(row * width, (row + 1) * width);
    const top = Math.max(...values);
    const exps = values.map(value => Math.exp(value - top));
    const total = exps.reduce((a, b) => a + b, 0);
    expected.push(...exps.map(value => value / total));
}
const programs = {
    transpose: `Tops = A max axis 1
Shift' = A transpose - Tops
Exps = Shift transpose exp
Totals = Exps sum axis 1
Weights' = Exps transpose / Totals
return Weights transpose`,
    ranked: `Tops = A max axis 1
Shift' = A - Tops rank 1 0
Exps = Shift exp
Totals = Exps sum axis 1
return Exps / Totals rank 1 0`,
    reshape: `Tops = A max axis 1
Rows' = Tops reshape # 1
Exps = (A - Rows) exp
Totals = Exps sum axis 1
Sums' = Totals reshape # 1
return Exps / Sums`,
};
const cases = Object.entries(programs).map(([variant, body]) => ({ workload: 'softmax', variant, body, expected }));
const centered = [], shifted = [];
for (let row = 0; row < height; row++) {
    const values = input.items.slice(row * width, (row + 1) * width);
    const mean = values.reduce((a, b) => a + b, 0) / width;
    const top = Math.max(...values);
    centered.push(...values.map(value => value - mean));
    shifted.push(...values.map(value => (value - top) * 2));
}
cases.push(
    { workload: 'centering', variant: 'helper', body: 'return A center rank 1', expected: centered },
    { workload: 'centering', variant: 'ranked', body: 'Means = A mean axis 1\nreturn A - Means rank 1 0', expected: centered },
);
const expressionExpected = shifted.reduce((a, b) => a + b, 0);
for (const tensorFusion of [false, true]) for (const { workload, variant, body, expected: answer } of [
    ...cases, { workload: 'expression', variant: 'ranked',
        body: 'Tops = A max axis 1\nreturn ((A - Tops rank 1 0) * 2) sum', expected: expressionExpected },
]) {
    let kernels = 0;
    const runtime = new Interpreter(undefined, { tensorFusion, onTensorKernelExecuted: () => kernels++ });
    try {
        runtime.execute(`use sequences\nuse numbers\nuse stats
fun Row center
  return Row - (Row mean)
end
fun A probe\n${body}\nend`);
        const fn = runtime.variables.get('probe');
        assert.equal(fn.kind, 'function');
        const invoke = () => {
            const result = demandValue(fn.call([input]));
            if (typeof result === 'number' || typeof result === 'bigint') return result;
            assert.equal(result.kind, 'array');
            return { shape: result.shape, items: result.items };
        };
        const verify = result => {
            if (typeof answer === 'number') {
                assert.ok(Math.abs(Number(result) - answer) < 1e-9);
                return;
            }
            assert.deepEqual(result.shape, [height, width]);
            assert.equal(result.items.length, answer.length);
            for (let i = 0; i < answer.length; i++) assert.ok(Math.abs(result.items[i] - answer[i]) < 1e-12);
        };
        for (let warmup = 0; warmup < 2; warmup++) verify(invoke());
        const times = [];
        for (let sample = 0; sample < count; sample++) {
            const start = performance.now();
            const result = invoke();
            times.push(performance.now() - start);
            verify(result);
        }
        const sorted = [...times].sort((a, b) => a - b);
        console.log(JSON.stringify({ node: process.version, rows: height, columns: width, tensorFusion, workload, variant,
            samplesMs: times, medianMs: sorted[Math.floor(sorted.length / 2)], kernels }));
    } finally { runtime.dispose(); }
}
