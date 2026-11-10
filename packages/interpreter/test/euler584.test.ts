import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/584_birthdayrevisited.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler584-original.ra', import.meta.url), 'utf8');
function run(n: number, k: number, d: number, options: InterpreterOptions = {}, text = source) {
    const r = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--k=${k}`, `--d=${d}`] });
    try { r.execute(text); return { answer: r.variables.get('Answer'), raw: r.variables.get('Raw') }; }
    finally { r.dispose(); }
}
// Enumerate labelled birthdays directly, including ties and wrapped windows.
// This oracle uses neither transfer states nor quadrature or matrix powers.
function expected(n: number, k: number, d: number): number {
    const counts = new Uint32Array(n), bound = Math.floor(n * (k - 1) / (d + 1));
    let expectation = 0;
    for (let people = 0; people <= bound; people++) {
        let valid = 0;
        const enumerate = (left: number): void => {
            if (left) {
                for (let day = 0; day < n; day++) { counts[day]++; enumerate(left - 1); counts[day]--; }
                return;
            }
            for (let day = 0; day < n; day++) {
                let total = 0;
                for (let offset = 0; offset <= d; offset++) total += counts[(day + offset) % n];
                if (total >= k) return;
            }
            valid++;
        };
        enumerate(people); expectation += valid / n ** people;
    }
    return Math.round(expectation * 1e8) / 1e8;
}
const cases = [[2, 1, 1], [2, 2, 1], [2, 3, 1], [2, 4, 1], [3, 2, 1], [3, 3, 1],
    [3, 4, 2], [4, 2, 1], [4, 3, 1], [4, 4, 2], [5, 2, 2], [5, 3, 1], [5, 4, 2], [7, 3, 3]];
const modes: InterpreterOptions[] = [{}, { compilation: false },
    { numberLoopCompilation: false, integerLoopCompilation: false, scalarFunctionCompilation: false,
        arrayFunctionCompilation: false, tensorCellCompilation: false, tensorFusion: false }];
describe.each(modes)('Euler 584 %j', options => {
    it.each(cases)('matches direct birthday assignments at N=%s K=%s D=%s', (n, k, d) => {
        expect(run(n, k, d, options).answer).toBe(expected(n, k, d));
    });
    it.each([[10, 3, 1, 5.78688636], [100, 3, 7, 8.48967364]])('retains statement values at N=%s K=%s D=%s', (n, k, d, answer) => {
        expect(run(n, k, d, options).answer).toBe(answer);
    });
    it('retains the full default', () => expect(run(365, 4, 7, options).answer).toBe(32.83822408), 30000);
});
it.each([[10, 3, 1], [100, 3, 7], [30, 4, 3]])('matches the original coefficient DP at N=%s K=%s D=%s', (n, k, d) => {
    expect(run(n, k, d).answer).toBe(run(n, k, d, {}, original).answer);
});
it('keeps the unrounded full result stable with an extra quadrature node', () => {
    const record = source.replace('Answer = Answer round 8', 'Raw = Answer\nAnswer = Answer round 8');
    const base = run(365, 4, 7, {}, record);
    const refined = run(365, 4, 7, {}, record.replace('Order = Limit // 2 + 1', 'Order = Limit // 2 + 2'));
    expect(base.answer).toBe(32.83822408); expect(refined.answer).toBe(base.answer);
    expect(Math.abs(Number(base.raw) - Number(refined.raw))).toBeLessThan(2e-9);
}, 30000);
