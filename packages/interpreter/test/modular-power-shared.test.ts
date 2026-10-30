import { expect, it } from 'vitest';
import { safeIntegerModularPower } from '../src/modular-power.js';

function exact(base: number, exponent: number, modulus: number) {
    let result = modulus === 1 ? 0n : 1n, factor = ((BigInt(base) % BigInt(modulus)) + BigInt(modulus)) % BigInt(modulus);
    for (let e = BigInt(exponent), m = BigInt(modulus); e > 0n; e >>= 1n) {
        if (e & 1n) result = result * factor % m;
        factor = factor * factor % m;
    }
    return Number(result);
}

it('shares squarings across a run without mixing bases or moduli', () => {
    const calls: [number, number, number][] = [];
    for (let i = 0; i < 40; i++) calls.push([7, 10000000 + i, 1000000007]);
    calls.push([7, 5, 1000000007], [8, 5, 1000000007], [8, 4294967295, 1000000007], [8, 4294967295, 998244353],
        [8, 3, 998244353], [-3, 4294967296 + 5, 998244353], [-3, 12, 1], [-3, 12, 1], [0, 0, 7], [0, 0, 7], [0, 9, 7],
        [1073741824, 33, 1073741824], [1073741824, 34, 1073741824]);
    for (const [b, e, m] of calls) expect(safeIntegerModularPower(b, e, m)).toBe(exact(b, e, m));
});
