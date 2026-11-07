import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
import { readArrayItem } from '../src/array-storage.js';
import type { RankArray } from '../src/value.js';

const source = readFileSync(new URL('../../../demos/euler/457_polynomialmodulosquare.ra', import.meta.url), 'utf8');
const backends = [{}, { compilation: false }, { numberLoopCompilation: false }];
function primes(limit: number): number[] {
    return Array.from({ length: Math.max(0, limit - 1) }, (_, i) => i + 2)
        .filter(p => { for (let d = 2; d * d <= p; d++) if (p % d === 0) return false; return true; });
}
function brute(limit: number): bigint {
    let answer = 0n;
    for (const prime of primes(limit)) {
        const square = prime * prime;
        for (let n = 1; n < square; n++) {
            if ((n * n - 3 * n - 1) % square === 0) { answer += BigInt(n); break; }
        }
    }
    return answer;
}
function solve(limit: number, options: object, check?: (runtime: Interpreter) => void) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--l=${limit}`] });
    const diagnostics = new RuntimeDiagnostics();
    try {
        diagnostics.run(() => runtime.execute(source));
        check?.(runtime);
        return { answer: runtime.variables.get('Answer'), diagnostics };
    } finally { runtime.dispose(); }
}
it.each([0, 1, 2, 3, 4, 5, 10, 13, 14, 17, 29, 50, 100, 200])('matches direct polynomial search at L=%s', limit => {
    const expected = brute(limit);
    for (const options of backends) expect(solve(limit, options).answer).toBe(expected);
});
it('retains existing fixtures on three backends', () => {
    for (const options of backends) {
        expect(solve(1000, options).answer).toBe(6728355n);
        expect(solve(100000, options).answer).toBe(3710903873569n);
    }
});
it('checks reciprocity selection and both lifted roots independently', () => {
    for (const options of backends) solve(1000, options, runtime => {
        const values = runtime.variables.get('Primes') as RankArray;
        const lifted = runtime.variables.get('Lifted') as RankArray;
        const other = runtime.variables.get('Other') as RankArray;
        const roots = runtime.variables.get('Root') as RankArray;
        const selected = new Set<bigint>();
        for (let i = 0; i < values.shape[0]; i++) {
            const prime = readArrayItem(values, i) as bigint, square = prime * prime;
            selected.add(prime);
            const root = readArrayItem(roots, i) as bigint;
            expect(root * root % prime).toBe(13n % prime);
            for (const result of [readArrayItem(lifted, i), readArrayItem(other, i)] as bigint[]) {
                expect(result > 0n && result < square).toBe(true);
                expect((result * result - 3n * result - 1n) % square).toBe(0n);
            }
        }
        for (const prime of primes(1000)) {
            let exists = false;
            if (prime !== 13) for (let n = 0; n < prime; n++)
                if ((n * n - 3 * n - 1) % prime === 0) { exists = true; break; }
            expect(selected.has(BigInt(prime))).toBe(exists);
        }
    });
});
it('retains the full answer and compiles both array loops', () => {
    const result = solve(10000000, {});
    expect(result.answer).toBe(2647787126797397063n);
    expect(result.diagnostics.numberLoops).toBeGreaterThanOrEqual(2);
}, 60000);
