import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/319_bounded.ra', import.meta.url), 'utf8');
const mod = 1_000_000_000n;

// Trial division and an ungrouped divisor sum are independent of the demo's
// linear sieve, quotient cache and grouped final sum.
function reference(n: number) {
    const mu = [0];
    const mertens = [0n];
    const coefficients = [0n];
    let two = 1n, three = 1n;
    for (let x = 1; x <= n; x++) {
        let rest = x, sign = 1;
        for (let p = 2; p * p <= rest; p++) {
            if (rest % p) continue;
            rest /= p;
            sign = -sign;
            if (rest % p === 0) { sign = 0; break; }
        }
        if (rest > 1 && sign) sign = -sign;
        mu.push(sign);
        mertens.push(mertens[x - 1] + BigInt(sign));
        two = two * 2n % mod;
        three = three * 3n % mod;
        coefficients.push((coefficients[x - 1] + three - two - 1n) % mod);
    }
    let answer = 1n;
    for (let d = 1; d <= n; d++) answer += BigInt(mu[d]) * coefficients[Math.floor(n / d)];
    return { answer: (answer % mod + mod) % mod, mertens };
}

for (const compilation of [false, true]) describe(`Euler 319 bottom-up cache (compiled=${compilation})`, () => {
    it.each([
        [1, 1], [2, 1], [5, 1], [20, 2], [20, 3], [20, 20],
        [97, 2], [100, 9], [100, 10], [100, 101], [256, 3],
    ])('matches a direct sum for N=%i, Limit=%i', (n, limit) => {
        const expected = reference(n);
        const runtime = new Interpreter(() => {}, { compilation });
        runtime.variables.set('N', BigInt(n));
        runtime.variables.set('Limit', BigInt(limit));
        try {
            runtime.execute(source);
            expect(runtime.variables.get('Answer')).toBe(expected.answer);
            // Only floor(N / d) values are needed by this program's cache.
            const quotients = new Set(Array.from({ length: n }, (_, i) => Math.floor(n / (i + 1))));
            for (const x of quotients) expect(runtime.execute(`${x} mertens`)).toBe(expected.mertens[x]);
        } finally { runtime.dispose(); }
    });
});
