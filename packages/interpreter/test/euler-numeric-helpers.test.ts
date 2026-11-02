import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const lattice = readFileSync(new URL('../../../demos/euler/507_shortestlattice.ra', import.meta.url), 'utf8');
const median = readFileSync(new URL('../../../demos/euler/513_integralmedian.ra', import.meta.url), 'utf8');
const stop = lattice.indexOf('rem Bound each partial');
if (stop < 0) throw new Error('missing lattice helper boundary');
const latticePrefix = lattice.slice(0, stop);
const medianPrefix = median.slice(0, median.indexOf('fun Sl It Dn Lo Hi Bd trap\n'));
const norm = (v: number[]) => v.reduce((sum, n) => sum + Math.abs(n), 0);
function shortest(a: number[], b: number[]) {
    let det = 0, x = 0, y = 1;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const d = Math.abs(a[i] * b[j] - a[j] * b[i]);
        if (d > det) { det = d; x = i; y = j; }
    }
    if (!det) return undefined;
    let best = Math.min(norm(a), norm(b));
    // Any shorter vector has each coordinate bounded by best. Cramer's rule
    // then bounds both integer coefficients, giving an exhaustive oracle.
    const u = Math.floor(best * (Math.abs(b[x]) + Math.abs(b[y])) / det);
    const v = Math.floor(best * (Math.abs(a[x]) + Math.abs(a[y])) / det);
    for (let k = -u; k <= u; k++) for (let l = -v; l <= v; l++) {
        if (k || l) best = Math.min(best, norm(a.map((n, i) => k * n + l * b[i])));
    }
    return BigInt(best);
}

for (const compilation of [false, true]) describe(`Euler numeric helpers (compiled=${compilation})`, () => {
    it('reduces arbitrary small independent bases against exhaustive coefficients', () => {
        let calls = 0;
        const diagnostics = new RuntimeDiagnostics();
        const runtime = new Interpreter(() => {}, { compilation, onScalarFunctionExecuted: () => calls++ });
        try {
            runtime.execute(latticePrefix);
            let seed = 503;
            const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % 9 - 4; };
            for (let i = 0; i < 200; i++) {
                const a = Array.from({ length: 3 }, next), b = Array.from({ length: 3 }, next);
                const expected = shortest(a, b);
                if (expected === undefined) continue;
                const args = [...a, ...b].map(n => n < 0 ? `(${n})` : n).join(' ');
                const actual = diagnostics.run(() => runtime.execute(`${args} shortest`));
                expect(actual, `${a}; ${b}`).toBe(expected);
            }
            if (compilation) { expect(calls).toBeGreaterThan(0); expect(diagnostics.numberFunctions).toBeGreaterThan(0); }
        } finally { runtime.dispose(); }
    });

    it('computes signed floor sums and reversed intervals by direct enumeration', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(medianPrefix);
            for (let i = 0; i < 150; i++) {
                const a = BigInt(i % 17 - 8), b = BigInt(i % 23 - 11), d = BigInt(i % 11 + 1);
                const lo = i % 19 - 9, hi = (i * 7) % 25 - 12, boundary = i % 2 === 0;
                let expected = 0n;
                for (let x = Math.min(lo, hi) + 1; x <= Math.max(lo, hi); x++) {
                    const numerator = a * BigInt(x) + b - (boundary ? 0n : 1n);
                    const value = numerator / d - (numerator % d < 0n ? 1n : 0n);
                    expected += hi >= lo ? value : -value;
                }
                const args = [a, b, d, BigInt(lo), BigInt(hi)].map(n => n < 0n ? `(${n})` : n).join(' ');
                expect(runtime.execute(`${args} ${boundary} trapone`), args).toBe(expected);
            }
            const a = 10n ** 25n, b = -(10n ** 30n), d = 17n;
            let expected = 0n;
            for (let x = -2n; x <= 4n; x++) { const n = a * x + b; expected += n / d - (n % d < 0n ? 1n : 0n); }
            expect(runtime.execute(`${a} (${b}) 17 (-3) 4 true trapone`)).toBe(expected);
        } finally { runtime.dispose(); }
    });
});
