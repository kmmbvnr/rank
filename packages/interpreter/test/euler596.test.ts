import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/596_hyperballpoints.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler596-original.ra', import.meta.url), 'utf8');
function run(text: string, radius: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--r=${radius}`] });
    try { runtime.execute(text); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
/** Count coordinate pairs independently, then join their squared lengths. */
function brute(radius: number) {
    const square = radius * radius, pairs = new Array<number>(square + 1).fill(0);
    for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) {
        const distance = x * x + y * y;
        if (distance <= square) pairs[distance]++;
    }
    let total = 0, prefix = 0;
    for (let i = 0; i <= square; i++) { prefix += pairs[i]; total += pairs[square - i] * prefix; }
    return BigInt(total);
}
describe.each([false, true])('Euler 596 (compilation=%s)', compilation => {
    it.each([0, 1, 2, 3, 4, 5, 7, 10, 12])('matches independent lattice enumeration at R=%s', radius => {
        expect(run(source, radius, compilation)).toBe(brute(radius));
    });
    it.each([99, 100, 101, 10000, 524287, 524288, 524289, 1048577])
    ('matches the original quotient grouping at R=%s', radius => {
        expect(run(source, radius, compilation)).toBe(run(original, radius, true));
    }, 10000);
    it('keeps the exact full answer', () => {
        expect(run(source, 100000000, compilation)).toBe(734582049n);
    }, 60000);
});
