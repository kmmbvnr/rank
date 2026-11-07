import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { reference } from '../../../benchmarks/euler752-investigation.mjs';
const source = readFileSync(new URL('../../../demos/euler/752_powers.ra', import.meta.url), 'utf8');
for (const compilation of [false, true]) describe(`Euler 752, compilation=${compilation}`, () => {
    it.each([2, 4, 5, 7, 10, 25, 49, 100, 343, 1000])('matches independent stripping and lifting at Limit=%s', limit => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg Limit integer = 1000000', `Limit = ${limit}`));
            expect(runtime.variables.get('Answer')).toBe(BigInt(reference(limit)));
            if (limit === 343) {
                for (const [modulus, period] of [[5, 12], [7, 7], [25, 60], [49, 49], [343, 343]]) {
                    expect(runtime.execute(`Orders ${modulus}`)).toBe(BigInt(period));
                }
                expect(runtime.execute('35 period')).toBe(84n);
            }
        } finally { runtime.dispose(); }
    });
});
