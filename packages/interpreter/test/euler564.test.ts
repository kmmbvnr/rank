import { fullScale } from './full-scale.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type InterpreterOptions } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
const source = readFileSync(new URL('../../../demos/euler/564_maximalpolygons.ra', import.meta.url), 'utf8');
const { compositions, partitions } = await import(new URL('../../../benchmarks/euler564-oracle.mjs', import.meta.url).href);
const small = Array.from({ length: 8 }, (_, i) => compositions(i + 3));
function run(k: number, options: InterpreterOptions = {}) {
    const r = new Interpreter(() => {}, { ...options, args: [`--k=${k}`] });
    try {
        r.execute(source);
        const means = r.variables.get('Means');
        if (!means || !isRankArray(means)) throw Error('expected mean vector');
        return { answer: r.variables.get('Answer'), total: r.variables.get('Total') as number,
            means: Array.from({ length: means.shape[0] }, (_, i) => readArrayItem(means, i) as number) };
    } finally { r.dispose(); }
}
for (const options of [{}, { compilation: false }, { numberLoopCompilation: false }]) describe(`Euler 564 ${JSON.stringify(options)}`, () => {
    it.each([0, 1, 2])('retains the empty prefix K=%s', k => {
        expect(run(k, options)).toEqual({ answer: 0, total: 0, means: [] });
    });
    it.each([3, 4, 5, 6, 8, 10])('matches ordered compositions through K=%s', k => {
        const actual = run(k, options), expected = small.slice(0, k - 2).map((entry: { mean: number }) => entry.mean);
        const sum = expected.reduce((a: number, b: number) => a + b, 0);
        expect(actual.answer).toBe(Number(sum.toFixed(6)));
        actual.means.forEach((mean, i) => expect(Math.abs(mean - expected[i])).toBeLessThan(2e-9));
    });
    fullScale('matches every full-scale prefix with exact multinomial reference weights', () => {
        const reference = partitions(50);
        const actual = run(50, options);
        expect(actual.answer).toBe(12363.69885);
        expect(actual.means).toHaveLength(48);
        let total = 0;
        actual.means.forEach((mean, i) => {
            expect(Math.abs(mean - reference.means[i])).toBeLessThan(2e-9);
            total += mean;
            expect(total.toFixed(6), `S(${i + 3})`).toBe(reference.prefixes[i].toFixed(6));
        });
    }, 180000);
});
it('matches the equilateral triangle and the endpoint quadrilateral exactly', () => {
    const actual = run(4);
    expect(actual.means[0]).toBeCloseTo(Math.sqrt(3) / 4, 13);
    expect(actual.means[1]).toBeCloseTo(3 * Math.sqrt(3) / 4, 12);
});
it('executes fused real arc helpers and stored-key reductions', () => {
    const r = new Interpreter(() => {}, { args: ['--k=10'] }), d = new RuntimeDiagnostics();
    try {
        d.run(() => r.execute(source));
        expect(r.variables.get('Answer')).toBe(66.955511);
        expect(d.compiledArrayFunctions).toBeGreaterThan(0);
        expect(d.realKeyedFolds).toBeGreaterThan(0);
    } finally { r.dispose(); }
});
