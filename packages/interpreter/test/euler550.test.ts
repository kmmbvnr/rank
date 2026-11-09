import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, type InterpreterOptions } from '../src/index.js';
import { arrayValues } from '../src/array-storage.js';
import { isRankArray } from '../src/value.js';
const source = readFileSync(new URL('../../../demos/euler/550_divisorgame.ra', import.meta.url), 'utf8');
const modulus = 987654321n;
// Independent game oracle: enumerate proper divisors and every legal split.
const grundy = Array<number>(101).fill(0);
for (let n = 2; n < grundy.length; n++) {
    const divisors = Array.from({ length: n - 2 }, (_, i) => i + 2).filter(d => n % d === 0);
    const reached = new Set(divisors.flatMap(a => divisors.map(b => grundy[a] ^ grundy[b])));
    while (reached.has(grundy[n])) grundy[n]++;
}
function oracle(n: number, k: number) {
    const counts = Array<bigint>(32).fill(0n);
    for (let value = 2; value <= n; value++) counts[grundy[value]]++;
    let dp = counts.map(() => 0n); dp[0] = 1n;
    for (let i = 0; i < k; i++) {
        const next = counts.map(() => 0n);
        for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++) next[a ^ b] += dp[a] * counts[b];
        dp = next.map(x => x % modulus);
    }
    return (BigInt(Math.max(0, n - 1)) ** BigInt(k) - dp[0] + modulus) % modulus;
}
function solve(n: number, k: number | string, options: InterpreterOptions) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--k=${k}`] });
    try {
        runtime.execute(source);
        const histogram = runtime.variables.get('Histogram');
        if (histogram === undefined || !isRankArray(histogram)) throw Error('missing histogram');
        return { answer: runtime.variables.get('Answer'), histogram: [...arrayValues(histogram)] };
    } finally { runtime.dispose(); }
}
const modes = [{ name: 'Number', options: {} }, { name: 'exact', options: { numberLoopCompilation: false } }, { name: 'reference', options: { compilation: false } }];
describe.each(modes)('Euler 550 $name', ({ options }) => {
    it.each([0, 1, 2, 3, 4, 7, 8, 9, 10, 15, 16, 24, 25, 26, 27, 31, 32, 48, 49, 50, 63, 64, 100])('matches direct game states at N=%s', n => {
        for (const k of [0, 1, 2, 3, 5]) expect(solve(n, k, options).answer).toBe(oracle(n, k));
    });
    it('counts prime factors with multiplicity without a dense Omega table', () => {
        const expected = [0n];
        for (let n = 2; n <= 10000; n++) {
            let rest = n, count = 0;
            for (let p = 2; p * p <= rest; p++) while (rest % p === 0) { rest /= p; count++; }
            if (rest > 1) count++;
            expected[count] = (expected[count] ?? 0n) + 1n;
        }
        expect(solve(10000, 1, options).histogram).toEqual(expected);
    });
    it('matches the full golden answer for a trillion starting tokens', () => {
        const result = solve(10000000, '1000000000000', options);
        expect(result.answer).toBe(328104836n);
        expect(result.histogram.reduce<bigint>((sum, count) => sum + (count as bigint), 0n)).toBe(9999999n);
    }, 30000);
});
