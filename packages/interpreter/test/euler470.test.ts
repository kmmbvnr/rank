import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const fixture = new URL('../../../demos/euler/470_superramvok_test.ra', import.meta.url);
const source = readFileSync(new URL('470_superramvok.ra', fixture), 'utf8');
const backends: InterpreterOptions[] = [{}, { compilation: false }, { numberLoopCompilation: false }];
// Direct faces and expected birth-death visits: no prefix-mask lookup,
// gain histogram, sorting or linear solver from the Rank implementation.
function direct(n: number) {
    const choose = (n: number, k: number) => {
        let result = 1;
        for (let j = 1; j <= k; j++) result = result * (n - j + 1) / j;
        return result;
    };
    let total = 0, scores: number[] = [];
    for (let d = 4; d <= n; d++) {
        scores = Array(n + 1).fill(0);
        for (let mask = 1; mask < 2 ** d; mask++) {
            const faces = Array.from({ length: d }, (_, j) => j + 1).filter(face => mask & 2 ** (face - 1));
            const weight = faces.reduce((sum, _, j) => sum + 1 / choose(d - 1, j), 0);
            scores[0] += Math.max(...faces) * weight;
            let value = 0;
            for (let step = 0; step < d; step++) {
                const next = faces.reduce((sum, face) => sum + Math.max(face, value), 0) / faces.length;
                for (let cost = 1; cost <= n; cost++) scores[cost] += Math.max(next - value - cost, 0) * weight;
                value = next;
            }
        }
        total += scores.reduce((a, b) => a + b, 0);
    }
    return { answer: BigInt(Math.round(total)), scores };
}
function solve(n: number, options: InterpreterOptions) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try {
        runtime.execute(source);
        const costs = runtime.variables.get('Sd');
        if (!costs || typeof costs !== 'object' || !('items' in costs)) throw Error('Missing Sd');
        return { answer: runtime.variables.get('Answer'), scores: Array.from(costs.items, Number) };
    } finally { runtime.dispose(); }
}
it.each([0, 1, 3, 4, 5, 6, 7, 8, 10])('matches independent per-subset profits at N=%s', n => {
    const expected = direct(n);
    for (const options of backends) {
        const result = solve(n, options);
        expect(result.answer).toBe(expected.answer);
        if (n >= 4) for (let c = 0; c <= n; c++) expect(result.scores[c]).toBeCloseTo(expected.scores[c], 7);
        else expect(result.scores.every(value => value === 0)).toBe(true);
    }
});
it.each(backends)('retains both imported examples with options=%j', options => {
    const results: boolean[] = [];
    const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
        loadModule(specifier) {
            expect(specifier).toBe('470_superramvok');
            return { id: new URL('470_superramvok.ra', fixture).pathname, source };
        }, onTestResult: result => results.push(result.passed) });
    try { runtime.execute(readFileSync(fixture, 'utf8')); expect(results).toEqual([true, true]); }
    finally { runtime.dispose(); }
});
it.each([{}, { compilation: false }])('matches the independent full long-double oracle with options=%j', options => {
    const result = solve(20, options);
    expect(result.answer).toBe(147668794n);
    expect(result.scores[1]).toBeCloseTo(12533140.4738969412, 3);
}, 30000);
