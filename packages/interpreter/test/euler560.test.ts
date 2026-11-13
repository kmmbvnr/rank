import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/560_coprimenim.ra', import.meta.url), 'utf8');
const { solve: oracle } = await import(new URL('../../../benchmarks/euler560-oracle.mjs', import.meta.url).href);
function solve(n: number, k: number, options: InterpreterOptions = {}) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--k=${k}`] });
    try { r.execute(source); return answerOf(r); }
    finally { r.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 560 %j', options => {
    it.each([[1, 0], [1, 1], [2, 0], [2, 1], [2, 2], [2, 3], [3, 4], [4, 5], [5, 2], [6, 7], [8, 3], [9, 4], [10, 5], [12, 6], [15, 7]])('matches legal-move Grundy DP at N=%s K=%s', (n, k) => {
        expect(solve(n, k, options)).toBe(oracle(n, k));
    });
    it.each([[10, 10, 472400303n], [1000, 1000, 954021836n], [10000000, 10000000, 994345168n]])('retains N=%s K=%s', (n, k, answer) => {
        expect(solve(n, k, options)).toBe(answer);
    }, 15000);
});
it('compiles every Walsh stage as an array helper', () => {
    const diagnostics = new RuntimeDiagnostics(), r = new Interpreter(() => {});
    try {
        diagnostics.run(() => r.execute(source));
        expect(diagnostics.compiledArrayFunctions).toBe(20);
    } finally { r.dispose(); }
});
