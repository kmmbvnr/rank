import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/370_triangles.ra', import.meta.url), 'utf8')
    .replace('use io', '').replace('use cli', '')
    .replace(/option Limit integer = \d+/, '')
    .replace('Answer = Limit triangles', '').replace('Answer print', '');

// Enumerate each primitive pair independently of SPF, signed divisors,
// square-root bounds and quotient blocks.
function reference(limit: number): bigint {
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    let answer = 0;
    for (let p = 1; 3 * p * p <= limit; p++) {
        for (let q = p; q * q < p * p + p * q && p * p + p * q + q * q <= limit; q++) {
            if (gcd(p, q) === 1) answer += Math.floor(limit / (p * p + p * q + q * q));
        }
    }
    return BigInt(answer);
}

it.each([false, true])('matches exhaustive geometric triangles around row and quotient boundaries (compilation=%s)', compilation => {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        runtime.execute(source);
        const inputs = new Set(Array.from({ length: 50 }, (_, i) => i + 3));
        for (const bound of [64, 81, 100, 125, 216, 343, 512, 729, 1000, 4096]) {
            for (const delta of [-1, 0, 1]) inputs.add(bound + delta);
        }
        for (const limit of inputs) expect(runtime.execute(`${limit} triangles`), `Limit=${limit}`).toBe(reference(limit));
    } finally { runtime.dispose(); }
});

it('matches exhaustive counts on larger inputs with both counting branches', () => {
    const runtime = new Interpreter(() => {});
    try {
        runtime.execute(source);
        for (const limit of [10000, 100000, 1000000]) {
            expect(runtime.execute(`${limit} triangles`), `Limit=${limit}`).toBe(reference(limit));
        }
    } finally { runtime.dispose(); }
});
