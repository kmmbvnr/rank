import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';

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
        return answerOf(runtime) as bigint;
    } finally { runtime.dispose(); }
}
for (const compilation of [false, true]) describe(`Euler 735 (compiled=${compilation})`, () => {
    it.each([1, 2, 3, 4, 5, 8, 9, 10, 15, 16, 17, 24, 25, 26, 31, 49, 50, 63, 64, 65, 99, 100, 101, 257, 999, 1000, 1001, 4095, 4096, 4097])('matches direct divisor counts through %i', limit => {
        expect(run(limit, 128, compilation)).toBe(brute(limit));
    });
    it.each([1, 7, 64, 1024])('keeps chunk budget %i independent of the result', budget => {
        expect(run(1000, budget, compilation)).toBe(15066n);
    });
});
