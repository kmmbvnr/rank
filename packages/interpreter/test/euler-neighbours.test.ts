import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics } from '../src/index.js';

const names = { 501: 'eightdivisors', 502: 'countingcastles', 504: 'squareinside', 505: 'bidirectional',
    507: 'shortestlattice', 511: 'nicesequences', 513: 'integralmedian' };
const sources = new Map(Object.entries(names).map(([id, name]) => [id,
    readFileSync(new URL(`../../../demos/euler/${id}_${name}.ra`, import.meta.url), 'utf8')]));
function run(id: keyof typeof names, inputs: Record<string, number>, compilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, args: Object.entries(inputs).map(([name, n]) => `--${name.toLowerCase()}=${n}`) });
    try { runtime.execute(sources.get(String(id))!); return runtime.variables.get('Answer'); }
    finally { runtime.dispose(); }
}
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;

for (const compilation of [false, true]) describe(`Euler neighbour oracles (compiled=${compilation})`, () => {
    it('counts eight-divisor numbers by independent divisor enumeration', () => {
        const counts = new Int32Array(10001);
        for (let d = 1; d < counts.length; d++) for (let n = d; n < counts.length; n += d) counts[n]++;
        for (const n of [0, 1, 7, 8, 24, 30, 100, 500, 1000, 10000]) {
            const expected = counts.slice(0, n + 1).filter(v => v === 8).length;
            expect(run(501, { N: n }, compilation)).toBe(BigInt(expected));
        }
    });

    it('streams Tribonacci pairs across chunk boundaries', () => {
        // Independent rational-median C++ oracle, including zero work.
        for (const [n, expected] of [[0, 0n], [1, 32n], [10, 130762273722n],
            [64, 936150550230n], [65, 947213001812n], [257, 3995027541434n]] as const) {
            for (const lc of [0, 3, 20]) expect(run(507, { N: n, Lc: lc }, compilation)).toBe(expected);
        }
    });

    it('counts square-interior quadrilaterals directly', () => {
        for (const m of [1, 2, 3, 4, 5, 6]) {
            let expected = 0;
            for (let a = 1; a <= m; a++) for (let b = 1; b <= m; b++)
                for (let c = 1; c <= m; c++) for (let d = 1; d <= m; d++) {
                    const inside = ((a + c) * (b + d) - gcd(a, b) - gcd(b, c) - gcd(c, d) - gcd(d, a)) / 2 + 1;
                    if (Number.isInteger(Math.sqrt(inside))) expected++;
                }
            expect(run(504, { M: m }, compilation)).toBe(BigInt(expected));
        }
    });

    it('counts integral medians by direct triangle enumeration', () => {
        const counts = new Int32Array(61);
        for (let c = 1; c <= 60; c++) for (let a = 1; a <= c; a++) for (let b = a; b <= c; b++) {
            const square = (2 * a * a + 2 * b * b - c * c) / 4;
            if (a + b > c && Number.isInteger(Math.sqrt(square))) counts[c]++;
        }
        for (const n of [1, 2, 3, 4, 5, 10, 20, 30, 50, 60]) {
            const expected = counts.slice(0, n + 1).reduce((a, b) => a + b, 0);
            expect(run(513, { N: n }, compilation)).toBe(BigInt(expected));
        }
    });

    it('counts divisor residues by one-step dynamic programming', () => {
        for (let n = 1; n <= 12; n++) for (const k of [1, 2, 5, 8]) {
            const divisors = Array.from({ length: n }, (_, i) => i + 1).filter(d => n % d === 0);
            let counts = Array<bigint>(k).fill(0n); counts[0] = 1n;
            for (let i = 0; i < n; i++) {
                const next = Array<bigint>(k).fill(0n);
                for (let r = 0; r < k; r++) for (const d of divisors) next[(r + d) % k] += counts[r];
                counts = next;
            }
            expect(run(511, { N: n, K: k }, compilation)).toBe(counts[(k - n % k) % k] % 1000000000n);
        }
    });

    it('matches linear generating-series coefficients for small castles', () => {
        function coefficient(w: number, p: bigint[], q: bigint[]) {
            const c: bigint[] = [];
            for (let i = 0; i <= w; i++) {
                let value = p[i] ?? 0n;
                for (let j = 1; j <= i; j++) value -= (q[j] ?? 0n) * c[i - j];
                c.push(value / q[0]);
            }
            return c[w];
        }
        function castles(w: number, h: number) {
            let total = 0n;
            for (const sign of [1n, -1n]) {
                let p = Array<bigint>(w + 1).fill(0n), q = [...p]; q[0] = 1n;
                let before = 0n;
                for (let i = 0; i < h; i++) {
                    before = coefficient(w, p, q);
                    const shift = p.map((_, j) => j ? p[j - 1] + q[j - 1] : 0n);
                    p = p.map((v, j) => sign * (v + shift[j]));
                    q = q.map((v, j) => v - shift[j]);
                }
                total += coefficient(w, p, q) - before;
            }
            return total / 2n;
        }
        for (let w = 1; w <= 6; w++) for (let h = 1; h <= 5; h++) {
            expect(run(502, { W1: w, H1: h, W2: w, H2: h, W3: w, H3: h }, compilation))
                .toBe(3n * castles(w, h) % 1000000007n);
        }
    });
});

it('compiles the unmodified array-style square lookup with packed gathers', () => {
    const diagnostics = new RuntimeDiagnostics(), runtime = new Interpreter(() => {});
    try {
        diagnostics.run(() => runtime.execute(sources.get('504')!));
        expect(runtime.variables.get('Answer')).toBe(694687n);
        expect(diagnostics.packedBooleanGathers).toBeGreaterThan(0);
    } finally { runtime.dispose(); }
});
