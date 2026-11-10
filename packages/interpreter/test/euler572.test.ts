import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/572_idempotentmatrices.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler572-original.ra', import.meta.url), 'utf8');
// Enumerate matrices directly, independently of the p w^T decomposition.
function oracle(bound: number): bigint {
    const radix = 2 * bound + 1, matrix = new Int32Array(9);
    let count = 0n;
    for (let code = 0; code < radix ** 9; code++) {
        let value = code;
        for (let i = 0; i < 9; i++) { matrix[i] = value % radix - bound; value = Math.floor(value / radix); }
        let valid = true;
        for (let row = 0; row < 3 && valid; row++) for (let column = 0; column < 3; column++) {
            let product = 0;
            for (let k = 0; k < 3; k++) product += matrix[row * 3 + k] * matrix[k * 3 + column];
            if (product !== matrix[row * 3 + column]) { valid = false; break; }
        }
        if (valid) count++;
    }
    return count;
}
function run(n: number, options: InterpreterOptions = {}, text = source) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
    try { r.execute(text); return r.variables.get('Answer'); } finally { r.dispose(); }
}
const expected = new Map([0, 1, 2].map(n => [n, oracle(n)]));
for (const n of [3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20]) expected.set(n, run(n, {}, original) as bigint);
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 572 %j', options => {
    it.each([...expected])('matches independent enumeration at bound %s', (n, answer) => {
        expect(run(n, options)).toBe(answer);
    }, 60000);
    it('retains the full default golden', () => expect(run(200, options)).toBe(19737656n), 60000);
});
it.each([1, 2, 7, 50, 200])('checks the max-p=1 polynomial against explicit orbit enumeration at %s', n => {
    const one = original.replace('for A in 1 to N', 'for A in 1 to 1');
    const polynomial = source.replace('for Largest in 2 to N', 'for Largest in 2 till 2');
    expect(run(n, {}, polynomial)).toBe(run(n, {}, one));
});
