import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions, type RankArray } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/558_irrationalbase.ra', import.meta.url), 'utf8');
const { solve: oracle, weight } = await import(new URL('../../../benchmarks/euler558-oracle.mjs', import.meta.url).href);
function solve(m: number, options: InterpreterOptions = {}, text = source) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--m=${m}`] });
    try { runtime.execute(text); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
describe.each([{}, { compilation: false }, { numberLoopCompilation: false }])('Euler 558 %j', options => {
    it.each([0, 1, 2, 3, 4, 10, 31, 32, 33, 100, 255, 256, 1000])('matches certified polynomial arithmetic through %s', m => {
        expect(solve(m, options)).toBe(oracle(m));
    });
    it('retains the larger statement fixture', () => {
        expect(solve(20000, options)).toBe(562820n);
    }, 15000);
    it.each([1, 3, 7, 31])('keeps partial batches at block width %s', block => {
        expect(solve(100, options, source.replace(/Block = \d+/, `Block = ${block}`))).toBe(oracle(100));
    }, 15000);
    it.each([999983, 1000000, 4999999, 5000000, 5000001, 16777217])('checks an isolated large square at %s', j => {
        expect(solve(j, options, source.replace('Start = 1', `Start = ${j}`))).toBe(BigInt(weight(BigInt(j) ** 2n)));
    }, 15000);
});
it('checks the statement decompositions with independent rational intervals', () => {
    expect(weight(3, true)).toEqual([2, -1, -5, -10]);
    expect(weight(10, true)).toEqual([6, -7, -10]);
    expect(oracle(10)).toBe(61n);
    expect(oracle(1000)).toBe(19403n);
});
it('proves the selected fixed-point precision and recurrence before searching', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(source.split('Block =')[0]);
        const budget = runtime.variables.get('Budget') as bigint, scale = runtime.variables.get('Scale') as bigint;
        expect(scale > 5n * budget ** 3n).toBe(true);
        const matrix = runtime.variables.get('Rows') as RankArray;
        const powers = runtime.variables.get('Powers') as RankArray;
        const rows = [...matrix.items] as bigint[], values = [...powers.items] as bigint[];
        expect(values.every((value, i) => value > 0n && (!i || value > values[i - 1]))).toBe(true);
        for (let i = 3; i < values.length; i++) {
            expect(values[i]).toBe(values[i - 1] + values[i - 3]);
            for (let axis = 0; axis < 3; axis++) expect(rows[i * 3 + axis]).toBe(rows[(i - 1) * 3 + axis] + rows[(i - 3) * 3 + axis]);
        }
    } finally { runtime.dispose(); }
});
