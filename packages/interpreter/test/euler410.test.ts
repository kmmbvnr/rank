import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/410_circleandtangent.ra', import.meta.url), 'utf8');
function solve(r: number, x: number, block: number, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation, args: [`--r=${r}`, `--x=${x}`, `--block=${block}`] });
    const diagnostics = new RuntimeDiagnostics();
    try { diagnostics.run(() => runtime.execute(source)); return { answer: runtime.variables.get('Answer'), diagnostics }; }
    finally { runtime.dispose(); }
}
// Independent trial division, without a segmented sieve or prime-power table.
function oracle(r: number, x: number) {
    let total = 0n;
    for (let m = 1; m <= Math.min(r, x); m++) {
        let n = m, weight = 1n;
        for (let p = 2; p * p <= n; p++) if (n % p === 0) {
            weight *= 2n;
            while (n % p === 0) n /= p;
        }
        if (n > 1) weight *= 2n;
        const a = BigInt(r) / BigInt(m), b = BigInt(x) / BigInt(m);
        total += weight * (m % 2 ? 2n * a * b : a * b + a % 2n * (b % 2n));
    }
    return 2n * total;
}
describe.each([false, true])('Euler 410 (compilation=%s)', compilation => {
    it('matches distinct-prime trial division at parity and prime-power boundaries', () => {
        for (const [r, x] of [[0, 5], [1, 5], [2, 10], [3, 9], [4, 17], [8, 27], [9, 25], [10, 100], [12, 20], [20, 12], [16, 31], [64, 65], [100, 100], [197, 251], [251, 197]]) {
            for (const block of [1, 17, 1000]) expect(solve(r, x, block, compilation).answer, `${r},${x},${block}`).toBe(oracle(r, x));
        }
    });
    it('retains the segmented fixture and statement values', () => {
        expect(solve(1, 5, 1, compilation).answer).toBe(20n);
        expect(solve(2, 10, 1, compilation).answer).toBe(104n);
        expect(solve(10, 100, 3, compilation).answer).toBe(6768n);
        expect(solve(200000, 300000, 70000, compilation).answer).toBe(479955026416n);
    });
    it('keeps wide first terms exact alongside bounded array stages', () => {
        const result = solve(1000, 1000000000000000, 1000, compilation);
        expect(result.answer).toBe(oracle(1000, 1000000000000000));
        if (compilation) {
            expect(result.diagnostics.mixedIntegerLoops).toBe(1);
            expect(result.diagnostics.costs['number-loop.wide-vector']?.boxedCells).toBeGreaterThan(0);
            expect(result.diagnostics.costs['number-loop.wide-vector']?.unboxedCells).toBeGreaterThan(0);
        }
    });
});
it('retains the full Euler 410 golden through private stages and an exact wide reduction', () => {
    const result = solve(100000000, 1000000000, 500000, true);
    expect(result.answer).toBe(799999783589946560n);
    expect(result.diagnostics.mixedIntegerLoops).toBe(1);
    expect(result.diagnostics.costs['number-loop.wide-vector']?.boxedCells).toBe(6);
    expect(result.diagnostics.costs['number-loop.wide-vector']?.unboxedCells).toBe(499994);
}, 60000);
