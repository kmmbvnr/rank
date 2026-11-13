import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/743_windowmatrix.ra', import.meta.url), 'utf8');
// Enumerate actual pairs of binary rows and test each sliding window.
function matrices(width: number, length: number): bigint {
    let count = 0n;
    for (let bits = 0; bits < 2 ** (2 * length); bits++) {
        let sum = 0, valid = true;
        const column = (i: number) => (bits >>> (2 * i) & 1) + (bits >>> (2 * i + 1) & 1);
        for (let i = 0; i < length; i++) {
            sum += column(i);
            if (i >= width) sum -= column(i - width);
            if (i >= width - 1 && sum !== width) { valid = false; break; }
        }
        if (valid) count++;
    }
    return count;
}
// Direct integer coefficients: no chunk ratios, modular inverses or scans.
function coefficient(width: number, length: number): bigint {
    const factorial = [1n];
    for (let i = 1; i <= width; i++) factorial.push(factorial[i - 1] * BigInt(i));
    const base = 2n ** BigInt(length / width);
    let sum = 0n;
    for (let x = 0; x <= width / 2; x++) sum += factorial[width]
        / (factorial[x] ** 2n * factorial[width - 2 * x]) * base ** BigInt(width - 2 * x);
    return sum;
}
function run(width: number, length: number, chunk: number, prime: number, compilation: boolean): unknown {
    const r = new Interpreter(() => {}, { compilation });
    try {
        r.execute(source.replace('arg Width integer = 10 ** 8', `Width = ${width}`)
            .replace('arg Length integer = 10 ** 16', `Length = ${length}`)
            .replace(/arg Chunk integer = \d+/, `Chunk = ${chunk}`)
            .replace('arg Prime integer = 1000000007', `Prime = ${prime}`));
        return answerOf(r);
    } finally { r.dispose(); }
}
const small = [[1, 1], [1, 3], [2, 2], [2, 4], [2, 6], [3, 3], [3, 6], [3, 9], [4, 4], [4, 8]]
    .map(([width, length]) => ({ width, length, expected: matrices(width, length) }));
for (const compilation of [false, true]) describe(`Euler 743 (compiled=${compilation})`, () => {
    it.each(small)('matches binary matrices at $width/$length', ({ width, length, expected }) => {
        for (const chunk of [1, 2, 16]) expect(run(width, length, chunk, 1000000007, compilation)).toBe(expected);
    });
    it.each([[3, 9, 560n], [4, 20, 1060870n]])('matches published A(%i,%i)', (width, length, expected) => {
        expect(run(Number(width), Number(length), 1, 1000000007, compilation)).toBe(expected);
    });
    it.each([5, 8, 19, 32])('matches direct coefficients with partial chunks at width %i', width => {
        for (const prime of [101, 1000000007]) for (const chunk of [1, 3, 7, 32]) {
            expect(run(width, width * 3, chunk, prime, compilation)).toBe(coefficient(width, width * 3) % BigInt(prime));
        }
    });
});
