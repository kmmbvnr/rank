import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/764_asymmetricdiophantine.ra', import.meta.url), 'utf8');
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
// Enumerate the original equation, independently of the three parameter grids.
function direct(limit: number): bigint {
    let sum = 0n;
    for (let x = 1; x <= limit / 4; x++) for (let y = 1; y * y <= limit; y++) {
        const square = 16 * x * x + y ** 4, z = Math.floor(Math.sqrt(square));
        if (z <= limit && z * z === square && gcd(gcd(x, y), z) === 1) sum += BigInt(x + y + z);
    }
    return sum;
}
for (const compilation of [false, true]) describe(`Euler 764 (compiled=${compilation})`, () => {
    it.each([1, 19, 20, 40, 41, 100, 200, 1000])('matches primitive equation solutions at %i', limit => {
        for (const block of [1, 3, 64, 256]) {
            const r = new Interpreter(() => {}, { compilation });
            try {
                r.execute(source.replace('arg Limit integer = 10 ** 16', `Limit = ${limit}`)
                    .replace(/arg Block integer = \d+/, `Block = ${block}`));
                expect(r.variables.get('Answer')).toBe(direct(limit));
            } finally { r.dispose(); }
        }
    });
    it.each([[10000, 112851n], [10000000, 248876211n]])('matches the published value at %i', (limit, expected) => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.execute(source.replace('arg Limit integer = 10 ** 16', `Limit = ${limit}`));
            expect(r.variables.get('Answer')).toBe(expected);
        } finally { r.dispose(); }
    });
});
