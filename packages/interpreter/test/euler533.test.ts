import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/533_carmichael.ra', import.meta.url), 'utf8');
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }
// Independent finite DP on exact Carmichael values. Introduce each prime
// power, combine lambda values by lcm, and retain the largest integer at each
// exact lambda. No logarithms, multiples sieve or p-1-divides-t inverse formula.
function states(limit: number) {
    if (limit <= 1) return new Map<number, bigint>();
    let best = new Map([[1, 1n]]);
    for (let prime = 2; prime <= limit; prime++) {
        let composite = false;
        for (let divisor = 2; divisor * divisor <= prime; divisor++) if (prime % divisor === 0) { composite = true; break; }
        if (composite) continue;
        const powers: { value: bigint; lambda: number }[] = [];
        for (let power = prime; ; power *= prime) {
            const lambda = prime === 2 && power >= 8 ? power / 4 : power / prime * (prime - 1);
            if (lambda >= limit) break;
            powers.push({ value: BigInt(power), lambda });
        }
        const next = new Map(best);
        for (const [previous, value] of best) for (const component of powers) {
            const lambda = previous / gcd(previous, component.lambda) * component.lambda;
            if (lambda >= limit) continue;
            const candidate = value * component.value;
            if (candidate > (next.get(lambda) ?? 0n)) next.set(lambda, candidate);
        }
        best = next;
    }
    return best;
}
function maximum(values: Iterable<bigint>) { let result = 0n; for (const value of values) if (value > result) result = value; return result; }
const limits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 16, 17, 20, 21, 22, 31, 32, 33, 60, 99, 100, 101, 200, 1000];
const expected = new Map(limits.map(limit => [limit, (maximum(states(limit).values()) + 1n) % 1000000000n]));
describe.each([
    { name: 'Number', options: {} },
    { name: 'exact compiled', options: { numberLoopCompilation: false } },
    { name: 'reference', options: { compilation: false } },
])('Euler 533 $name', ({ options }) => {
    it.each(limits)('matches exact lambda-state enumeration at N=%s', n => {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try { runtime.execute(source); expect(answerOf(runtime)).toBe(expected.get(n)); }
        finally { runtime.dispose(); }
    });
    it.each([60, 100, 200])('selects the exact maximum after a deliberately coarse log screen at N=%s', n => {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        try {
            runtime.execute(source.replace('Scale = 65536', 'Scale = 2'));
            expect(answerOf(runtime)).toBe(expected.get(n));
        } finally { runtime.dispose(); }
    });
    it('preserves dense/sparse batches and boundaries with a small event budget', () => {
        const runtime = new Interpreter(() => {}, { ...options, args: ['--n=1000'] });
        try {
            runtime.execute(source.replace(/Budget = \d+/, 'Budget = 7'));
            expect(answerOf(runtime)).toBe(expected.get(1000));
        } finally { runtime.dispose(); }
    });
    it.each([21, 1000])('matches every quantized score to independent inverse products at N=%s', n => {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`] });
        const probe = source.replace('    Result = (Positions + Begin) * 2', '    Result = Score')
            .replace('  Values = Candidates maximal rank 0\n  Largest = Values max\n  return (Largest + 1) mod 1000000000', '  return Candidates')
            .replace(/Budget = \d+/, 'Budget = 7');
        const table = [...states(n)], wanted: bigint[] = [];
        for (let t = 2 * Math.max(1, Math.floor(n / 4)); t < n; t += 2) {
            let value = maximum(table.filter(([lambda]) => t % lambda === 0).map(([, value]) => value));
            let score = 0;
            for (let factor = 2; value > 1n && factor <= n; factor++) while (value % BigInt(factor) === 0n) {
                value /= BigInt(factor);
                score += Math.trunc(Math.log(factor) * 65536);
            }
            expect(value).toBe(1n);
            wanted.push(BigInt(score));
        }
        try {
            runtime.execute(probe);
            const actual = answerOf(runtime);
            if (!actual || !isRankArray(actual)) throw Error('expected score array');
            expect([...actual.items]).toEqual(wanted);
        } finally { runtime.dispose(); }
    });
    it.each([1, 2, 3, 4, 6, 12, 60, 100, 360])('reconstructs the exact largest inverse at t=%s', t => {
        const runtime = new Interpreter(() => {}, options);
        const wanted = maximum([...states(t + 1)].filter(([lambda]) => t % lambda === 0).map(([, value]) => value));
        try {
            runtime.execute(source.slice(0, source.indexOf('fun Limit solve')));
            expect(runtime.execute(`${t} maximal`)).toBe(wanted);
        } finally { runtime.dispose(); }
    });
});
it('matches the full result with a private compiled score sieve', () => {
    const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        expect(answerOf(runtime)).toBe(789453601n);
        expect(diagnostics.numberLoops).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
}, 120_000);
