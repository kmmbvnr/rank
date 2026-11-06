import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
const source = readFileSync(new URL('../../../demos/euler/440_gcdandtiling.ra', import.meta.url), 'utf8');
function oracle(limit: number) {
    const tilings = [1n, 10n];
    for (let n = 2; n <= limit ** limit; n++) tilings.push(10n * tilings[n - 1] + tilings[n - 2]);
    const gcd = (a: bigint, b: bigint) => { while (b) [a, b] = [b, a % b]; return a; };
    let sum = 0n;
    for (let a = 1; a <= limit; a++) for (let b = 1; b <= limit; b++) for (let c = 1; c <= limit; c++) sum += gcd(tilings[c ** a], tilings[c ** b]);
    return sum % 987898789n;
}
for (const limit of [0, 1, 2, 3, 4, 5]) it(`matches direct exact tiling/GCD enumeration at L=${limit}`, () => {
    const expected = oracle(limit);
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--l=${limit}`] });
        try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(expected); }
        finally { runtime.dispose(); }
    }
});
for (const limit of [6, 31, 127, 128, 129, 257]) it(`matches the original doubling search across blocks at L=${limit}`, () => {
    const original = readFileSync(new URL('../../../benchmarks/experiments/euler440-original.ra', import.meta.url), 'utf8');
    const baseline = new Interpreter(() => {}, { compilation: false, args: [`--l=${limit}`] });
    let expected;
    try { baseline.execute(original); expected = baseline.variables.get('Answer'); }
    finally { baseline.dispose(); }
    for (const options of [{}, { numberLoopCompilation: false }, { compilation: false }]) {
        const runtime = new Interpreter(() => {}, { ...options, args: [`--l=${limit}`] });
        try { runtime.execute(source); expect(runtime.variables.get('Answer')).toBe(expected); }
        finally { runtime.dispose(); }
    }
});
