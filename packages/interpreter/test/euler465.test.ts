import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type InterpreterOptions } from '../src/index.js';
import type { RankArray } from '../src/value.js';
const source = readFileSync(new URL('../../../demos/euler/465_polarpolygons.ra', import.meta.url), 'utf8');
const backends: InterpreterOptions[] = [{}, { numberLoopCompilation: false }, { compilation: false }];
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }
function phi(n: number) {
    let count = 0;
    for (let k = 1; k <= n; k++) if (gcd(n, k) === 1) count++;
    return count;
}
function power(base: bigint, exponent: bigint, modulus: bigint) {
    let value = 1n;
    for (; exponent; exponent >>= 1n, base = base * base % modulus) if (exponent & 1n) value = value * base % modulus;
    return value;
}
// Direct levels, without quotient caches or reduced totient sums.
function direct(n: number, modulus = 1000000007n) {
    let product = 1n, first = 0n, second = 0n;
    for (let k = 1; k <= n; k++) {
        const count = BigInt(4 * phi(k)), weight = BigInt(Math.floor(n / k));
        product = product * power(weight + 1n, count, modulus) % modulus;
        first += count * weight; second += count * weight * weight;
    }
    return ((product * product - 1n - 2n * product * first + second) % modulus + modulus) % modulus;
}
// Actual grid rays: one vertex per selected ray, every angular gap < pi.
function geometric(n: number) {
    const rays = new Map<string, { x: number; y: number; weight: number }>();
    for (let x = -n; x <= n; x++) for (let y = -n; y <= n; y++) {
        const divisor = gcd(Math.abs(x), Math.abs(y));
        if (!divisor) continue;
        const key = `${x / divisor},${y / divisor}`, ray = rays.get(key);
        if (ray) ray.weight++; else rays.set(key, { x: x / divisor, y: y / divisor, weight: 1 });
    }
    const ordered = [...rays.values()].sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    let total = 0;
    for (let mask = 0; mask < 2 ** ordered.length; mask++) {
        const selected = ordered.filter((_, i) => mask & 2 ** i);
        if (selected.length < 3) continue;
        if (selected.every((a, i) => { const b = selected[(i + 1) % selected.length]; return a.x * b.y - a.y * b.x > 0; })) total += selected.reduce((product, ray) => product * ray.weight, 1);
    }
    return BigInt(total);
}
function solve(n: number, limit = 0, options: InterpreterOptions = {}, modulus = 1000000007) {
    const runtime = new Interpreter(() => {}, { ...options, args: [`--n=${n}`, `--limit=${limit}`] });
    const diagnostics = new RuntimeDiagnostics();
    try { diagnostics.run(() => runtime.execute(source.replace('\nMod = 1000000007\n', `\nMod = ${modulus}\n`))); return { answer: runtime.variables.get('Answer'), product: runtime.variables.get('Product'), diagnostics }; }
    finally { runtime.dispose(); }
}
it.each([0, 1, 2])('matches independent angular subset enumeration at N=%s', n => {
    const expected = geometric(n);
    expect(direct(n)).toBe(expected);
    for (const options of backends) expect(solve(n, 0, options).answer).toBe(expected);
});
it.each([3, 4, 5, 7, 8, 9, 16, 17, 25, 49, 100, 343])('matches direct levels at N=%s across table cutoffs', n => {
    const expected = direct(n);
    for (const options of backends) for (const limit of [0, 1, n]) expect(solve(n, limit, options).answer).toBe(expected);
});
it.each([3, 5, 7])('keeps positive zero-residue exponents and zero bases modulo %s', modulus => {
    for (const n of [2, 3, 6]) for (const options of backends) {
        const result = solve(n, 0, options, modulus);
        expect(result.answer).toBe(direct(n, BigInt(modulus)));
        if (n === 2 && modulus === 3) expect(result.product).toBe(0n);
    }
});
it('keeps exact totients and modular summatory caches for odd and even moduli', () => {
    const definitions = source.split('\nMod = 1000000007\n')[0];
    for (const options of backends) {
        const runtime = new Interpreter(() => {}, options);
        try {
            runtime.execute(definitions); runtime.execute('Phi = 20 totients');
            expect(Array.from((runtime.variables.get('Phi') as RankArray).items, Number)).toEqual(Array.from({ length: 21 }, (_, n) => phi(n)));
            for (const modulus of [2, 7, 1000000006, 1000000007]) {
                runtime.execute(`Prefix = Phi scan + mod ${modulus}\nCache = 100 totals Prefix ${modulus}`);
                const cache = runtime.variables.get('Cache') as RankArray;
                for (let i = 1; i <= 4; i++) {
                    const top = Math.floor(100 / i);
                    let sum = 0; for (let k = 1; k <= top; k++) sum += phi(k);
                    expect(cache.items[i]).toBe(BigInt(sum % modulus));
                }
            }
        } finally { runtime.dispose(); }
    }
});
it('retains imported captures across both fixture runs on every backend', () => {
    const fixture = new URL('../../../demos/euler/465_polarpolygons_test.ra', import.meta.url);
    for (const options of backends) {
        const results: { passed: boolean }[] = [];
        const runtime = new Interpreter(() => {}, { ...options, testing: true, sourceId: fixture.pathname,
            loadModule(specifier) { expect(specifier).toBe('465_polarpolygons'); return { id: new URL('465_polarpolygons.ra', fixture).pathname, source }; },
            onTestResult: result => results.push(result) });
        try { runtime.execute(readFileSync(fixture, 'utf8')); expect(results.map(result => result.passed)).toEqual([true, true]); }
        finally { runtime.dispose(); }
    }
});
it('retains the full default with three Number loops and no overflow replay', () => {
    const result = solve(96889010407);
    expect(result.answer).toBe(585965659n);
    expect(result.diagnostics.numberLoops).toBe(3);
    expect(result.diagnostics.numberLoopOverflows).toBe(0);
}, 120000);
