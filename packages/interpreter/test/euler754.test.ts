import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/754_gaussfactorials.ra', import.meta.url), 'utf8');
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
function direct(limit: number): bigint {
    let product = 1n;
    for (let n = 1; n <= limit; n++) for (let k = 1; k <= n; k++) {
        if (gcd(k, n) === 1) product = product * BigInt(k) % 1000000007n;
    }
    return product;
}
for (const compilation of [false, true]) describe(`Euler 754 (compiled=${compilation})`, () => {
    it.each([1, 2, 10, 31, 64, 127])('matches the direct coprime product at %i', limit => {
        const expected = direct(limit), root = Math.floor(Math.sqrt(limit));
        for (const chunk of [root, root + 3, 128]) {
            const runtime = new Interpreter(() => {}, { compilation });
            try {
                runtime.execute(source.replace(/arg Limit integer = \d+/, `Limit = ${limit}`)
                    .replace(/arg Chunk integer = \d+/, `Chunk = ${chunk}`));
                expect(answerOf(runtime)).toBe(expected);
            } finally { runtime.dispose(); }
        }
    });
});
