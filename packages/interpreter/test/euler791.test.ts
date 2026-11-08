import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/791_averagevariance.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler791-original.ra', import.meta.url), 'utf8');
// From mean = 2 * variance: 4 * sum(squares) = sum * (sum + 2).
// Enumerate ordered quadruples independently of the odd-triple transformation.
function exhaustive(limit: number): bigint {
    let answer = 0n;
    for (let a = 1; a <= limit; a++) for (let b = a; b <= limit; b++)
        for (let c = b; c <= limit; c++) for (let d = c; d <= limit; d++) {
            const sum = a + b + c + d;
            if (4 * (a * a + b * b + c * c + d * d) === sum * (sum + 2)) answer += BigInt(sum);
        }
    return answer;
}
function run(code: string, limit: number, compilation: boolean, modulus = 433494437): unknown {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(code.replace('arg Limit integer = 10 ** 8', `Limit = ${limit}`)
            .replace('arg Mod integer = 433494437', `Mod = ${modulus}`));
        return runtime.variables.get('Answer');
    } finally { runtime.dispose(); }
}
for (const compilation of [false, true]) describe(`Euler 791 (compiled=${compilation})`, () => {
    it.each([0, 1, 2, 3, 4, 5, 6, 10, 16, 25])('matches exhaustive quadruples at Limit=%i', limit => {
        expect(run(source, limit, compilation)).toBe(exhaustive(limit));
    });
    it('matches the published S(1000)', () => {
        expect(run(source, 1000, compilation)).toBe(37048340n);
    });
    it.each([1, 2, 7, -7, 433494437])('preserves interval sums with Mod=%i', modulus => {
        for (const limit of [7, 31, 128, 1001])
            expect(run(source, limit, compilation, modulus)).toBe(run(original, limit, compilation, modulus));
    });
});
