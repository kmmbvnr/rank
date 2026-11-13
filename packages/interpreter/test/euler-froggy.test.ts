import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

const source = readFileSync(new URL('../../../demos/euler/416_froggy.ra', import.meta.url), 'utf8');
// Enumerate routes independently of the matrix recurrence, then union each
// leg's visited squares. Reversing a route gives the homeward visit mask.
function oracle(m: number, n: number) {
    const routes = new Map<number, bigint>();
    function visit(x: number, mask: number): void {
        if (x === n - 1) { routes.set(mask, (routes.get(mask) ?? 0n) + 1n); return; }
        for (let jump = 1; jump <= 3; jump++) if (x + jump < n) visit(x + jump, mask | 1 << (x + jump));
    }
    visit(0, 1);
    let states = new Map([[1, 1n]]);
    for (let leg = 0; leg < 2 * m; leg++) {
        const next = new Map<number, bigint>();
        for (const [a, count] of states) for (const [b, ways] of routes) next.set(a | b, (next.get(a | b) ?? 0n) + count * ways);
        states = next;
    }
    let answer = 0n;
    for (const [mask, ways] of states) {
        let count = 0;
        for (let bits = mask; bits; bits >>>= 1) count += bits & 1;
        if (count >= n - 1) answer += ways;
    }
    return answer % 1000000000n;
}
function run(m: number, n: number | bigint, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--m=${m}`, `--n=${n}`] });
    try { runtime.execute(source); return answerOf(runtime); }
    finally { runtime.dispose(); }
}
describe.each([false, true])('Euler 416, compilation=%s', compilation => {
    it.each([1, 2, 3])('matches visited-square enumeration for %s round trips', m => {
        for (let n = 2; n <= 8; n++) expect(run(m, n, compilation)).toBe(oracle(m, n));
    });
    it('matches the published 100-square checkpoint', () => {
        expect(run(2, 100, compilation)).toBe(429619151n);
    });
    it('retains the full result', () => {
        expect(run(10, 1000000000000n, compilation)).toBe(898082747n);
    }, 30_000);
});
