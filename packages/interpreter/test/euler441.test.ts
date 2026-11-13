import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, isRankArray } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/441_inversesum.ra', import.meta.url), 'utf8');
function oracle(limit: number) {
    const gcd = (a: number, b: number) => { while (b) [a, b] = [b, a % b]; return a; };
    let total = 0, correction = 0;
    for (let q = 2; q <= limit; q++) for (let p = 1; p < q; p++) {
        if (gcd(p, q) !== 1) continue;
        const value = (Math.min(limit, p + q) - q + 1) / (p * q) - correction;
        const next = total + value;
        correction = (next - total) - value;
        total = next;
    }
    return total;
}
for (const n of [0, 1, 2, 3, 4, 5, 10, 31, 32, 33, 63, 64, 65, 100, 129, 250, 1000]) {
    it(`matches a direct coprime-pair oracle at N=${n} with approximate and direct harmonic tables`, () => {
        const expected = oracle(n);
        for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) for (const cut of [1, 3000]) {
            const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--cut=${cut}`, '--digits=8'] });
            try {
                runtime.execute(source);
                expect(runtime.variables.get('Raw')).toBeCloseTo(expected, 9);
                expect(answerOf(runtime)).toBe(Math.round(expected * 1e8) / 1e8);
            } finally { runtime.dispose(); }
        }
    });
}
function mobius(n: number) {
    let sign = 1;
    for (let p = 2; p * p <= n; p++) if (n % p === 0) {
        n /= p; sign *= -1;
        if (n % p === 0) return 0;
    }
    return n > 1 ? -sign : sign;
}
it('indexes the odd Mobius sieve across primes, squares and empty bounds', () => {
    const definition = source.slice(source.indexOf('fun Bound odd_mobius'), source.indexOf('\nRoot = N isqrt'));
    for (const options of [{}, { compilation: false }]) for (const bound of [0, 1, 2, 3, 9, 25, 49, 99, 1000]) {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.variables.set('Bound', BigInt(bound));
            const result = runtime.execute(`use numbers\nuse sequences\n${definition}\nBound odd_mobius`);
            if (result === undefined || !isRankArray(result)) throw Error('expected array');
            expect(result.items).toEqual(Array.from({ length: Math.floor((bound + 1) / 2) }, (_, i) => BigInt(mobius(2 * i + 1))));
        } finally { runtime.dispose(); }
    }
});
