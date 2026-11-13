import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/747_triangularpizza.ra', import.meta.url), 'utf8');
// Enumerate z and compare squared integers; use no square root or floor/ceil.
function direct(limit: number): bigint {
    let correction = 0n;
    for (let x = 1; x < limit; x++) for (let y = x; y < limit; y++) {
        const area = BigInt(x * y), discriminant = 4n * area * BigInt((x + 1) * (y + 1));
        for (let z = 0; z <= limit - 1 - x - y; z++) {
            const difference = BigInt(z) - 2n * area;
            if (difference < 0n) continue;
            const square = difference * difference;
            if (square >= discriminant) correction += (x === y ? 1n : 2n) * (square === discriminant ? 1n : 2n);
        }
    }
    const n = BigInt(limit);
    return (n + 18n) * (n - 1n) * (n - 2n) / 6n + 3n * correction;
}
const cases = [1, 2, 3, 4, 5, 6, 10, 12, 16, 25, 40, 64].map(limit => ({ limit, expected: direct(limit) }));
for (const compilation of [false, true]) describe(`Euler 747 (compiled=${compilation})`, () => {
    it.each(cases)('matches exact z enumeration at Limit=$limit', ({ limit, expected }) => {
        for (const prime of [101, 1000000007]) {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(source.replace('arg Limit integer = 10 ** 8', `Limit = ${limit}`)
                    .replace('arg Prime integer = 1000000007', `Prime = ${prime}`));
                expect(answerOf(r)).toBe(expected % BigInt(prime));
            } finally { r.dispose(); }
        }
    });
    it('preserves the existing Limit=1000 example', () => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(source.replace('arg Limit integer = 10 ** 8', 'Limit = 1000'));
            expect(answerOf(r)).toBe(172166601n);
        } finally { r.dispose(); }
    });
});
