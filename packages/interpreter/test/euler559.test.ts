import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/559_permutedmatrices.ra', import.meta.url), 'utf8');
const { solve: oracle } = await import(new URL('../../../benchmarks/euler559-oracle.mjs', import.meta.url).href);
function solve(n: number, options: InterpreterOptions, text = source) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { r.execute(text); return r.variables.get('Answer'); }
    finally { r.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 559 %j', options => {
    it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12])('matches ascent inclusion-exclusion at %s', n => {
        expect(solve(n, options)).toBe(oracle(n));
    });
    it.each([1, 2, 3, 8, 16, 64])('keeps the statement answer across batch cutoff %s', cut => {
        expect(solve(50, options, source.replace('Cut = 64 min N', `Cut = ${cut} min N`))).toBe(819573537n);
    });
    it.each([63, 64, 65, 127, 128, 129, 500])('matches the old recurrence through %s', n => {
        const original = readFileSync(new URL('../../../benchmarks/fixtures/euler559-original.ra', import.meta.url), 'utf8');
        expect(solve(n, options)).toBe(solve(n, { compilation: false }, original));
    });
    it('retains the full exact result', () => {
        expect(solve(50000, options)).toBe(684724920n);
    }, 30000);
});
