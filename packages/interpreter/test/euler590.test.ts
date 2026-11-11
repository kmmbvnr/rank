import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/590_setswithlcm.ra', import.meta.url), 'utf8');
const original = readFileSync(new URL('../../../benchmarks/fixtures/euler590-original.ra', import.meta.url), 'utf8');
function run(text: string, n: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--n=${n}`] });
    try { runtime.execute(text); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }
function brute(n: number): bigint {
    let target = 1;
    for (let i = 1; i <= n; i++) target = target / gcd(target, i) * i;
    const counts = new Map([[1, 1n]]);
    for (let divisor = 1; divisor <= target; divisor++) if (target % divisor === 0) {
        for (const [lcm, count] of [...counts]) {
            const next = lcm / gcd(lcm, divisor) * divisor;
            counts.set(next, (counts.get(next) ?? 0n) + count);
        }
    }
    return counts.get(target)! % 1000000000n;
}
describe.each([false, true])('Euler 590 (compilation=%s)', compilation => {
    it.each([0, 1, 2, 3, 4, 6, 9, 10, 16, 24, 25, 26, 27, 31, 32, 64, 100])
    ('preserves both CRT components and prime-power boundaries at N=%s', n => {
        expect(run(source, n, compilation)).toBe(run(original, n, true));
    });
    it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])('matches independent subset-LCM counts at N=%s', n => {
        expect(run(source, n, compilation)).toBe(brute(n));
    });
    it('preserves the full golden answer', () => {
        expect(run(source, 50000, compilation)).toBe(834171904n);
    }, 20000);

});
