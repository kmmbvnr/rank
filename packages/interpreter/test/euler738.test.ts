import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/738_orderedfactorisations.ra', import.meta.url), 'utf8');
// Enumerate nondecreasing tuples, including ones, for every permitted length.
function brute(limit: number, count: number): bigint {
    function tuples(left: number, least: number, product: number): bigint {
        if (left === 0) return 1n;
        let total = 0n;
        for (let factor = least; product * factor ** left <= limit; factor++) {
            total += tuples(left - 1, factor, product * factor);
        }
        return total;
    }
    let total = 0n;
    for (let length = 1; length <= count; length++) total += tuples(length, 1, 1);
    return total % 1000000007n;
}
for (const compilation of [false, true]) describe(`Euler 738 (compiled=${compilation})`, () => {
    it.each([1, 2, 3, 4, 8, 9, 10, 15, 16, 17, 24, 25, 26, 63, 64, 65, 100])('counts ordered products through %i', limit => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            for (const count of [1, 2, 3, 7]) {
                runtime.execute(source.replace('arg Limit integer = 10 ** 10', `Limit = ${limit}`)
                    .replace('arg Kmax integer = 10 ** 10', `Kmax = ${count}`));
                expect(runtime.variables.get('Answer')).toBe(brute(limit, count));
            }
        } finally { runtime.dispose(); }
    });
    it.each([[10, 153n], [100, 35384n]])('preserves the published example at limit %i', (limit, expected) => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Limit integer = 10 ** 10', `Limit = ${limit}`)
                .replace('arg Kmax integer = 10 ** 10', `Kmax = ${limit}`));
            expect(runtime.variables.get('Answer')).toBe(expected);
        } finally { runtime.dispose(); }
    });
});
