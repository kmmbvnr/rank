import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/374_partproduct.ra', import.meta.url), 'utf8');

// Distinct-part knapsack maximizes exact products independently of the
// production grouping, factorials and weighted harmonic recurrence.
function partitionSums(limit: number): bigint[] {
    const products = Array<bigint>(limit + 1).fill(0n), counts = Array<bigint>(limit + 1).fill(0n);
    products[0] = 1n;
    for (let part = 1; part <= limit; part++) {
        for (let sum = limit; sum >= part; sum--) {
            if (products[sum - part] === 0n) continue;
            const product = products[sum - part] * BigInt(part);
            if (product > products[sum]) {
                products[sum] = product;
                counts[sum] = counts[sum - part] + 1n;
            } else if (product === products[sum]) {
                expect(counts[sum]).toBe(counts[sum - part] + 1n);
            }
        }
    }
    const sums = [0n];
    for (let n = 1; n <= limit; n++) sums[n] = (sums[n - 1] + products[n] * counts[n]) % 982451653n;
    return sums;
}
const expected = partitionSums(240);

it.each([false, true])('matches exact partition products through complete and partial groups (compilation=%s)', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        for (let limit = 0; limit < expected.length; limit++) {
            runtime.execute(source.replace('arg Limit integer = 10 ** 14', `Limit = ${limit}`));
            expect(runtime.variables.get('Answer'), `Limit=${limit}`).toBe(expected[limit]);
        }
    } finally { runtime.dispose(); }
});

it('computes the full partition-product golden in one numeric loop without array storage', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(runtime.variables.get('Answer')).toBe(334420941n);
        expect(diagnostics.numberLoops).toBe(1);
        expect(diagnostics.numberLoopOverflows).toBe(0);
        expect(diagnostics.typedArrayPublishedCells).toBe(0);
    } finally { runtime.dispose(); }
}, 30000);
