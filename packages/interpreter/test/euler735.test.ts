import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/735_divisorsoftwo.ra', import.meta.url), 'utf8');
// Count divisors directly, without the Mobius decomposition or ragged tasks.
function brute(limit: number): bigint {
    let total = 0n;
    for (let n = 1; n <= limit; n++) for (let divisor = 1; divisor <= n; divisor++) {
        if ((2 * n * n) % divisor === 0) total++;
    }
    return total;
}
function run(limit: number, budget: number, compilation: boolean): bigint {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(source.replace('arg Limit integer = 10 ** 12', `Limit = ${limit}`)
            .replace('arg Budget integer = 16777216', `Budget = ${budget}`));
        return runtime.variables.get('Answer') as bigint;
    } finally { runtime.dispose(); }
}
for (const compilation of [false, true]) describe(`Euler 735 (compiled=${compilation})`, () => {
    it.each([1, 2, 3, 4, 5, 10, 15, 31, 64, 100, 257, 1000])('matches direct divisor counts through %i', limit => {
        expect(run(limit, 128, compilation)).toBe(brute(limit));
    });
    it.each([1, 7, 64, 1024])('keeps chunk budget %i independent of the result', budget => {
        expect(run(1000, budget, compilation)).toBe(15066n);
    });
});
