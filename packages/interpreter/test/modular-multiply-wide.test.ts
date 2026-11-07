import { expect, it } from 'vitest';
import { multiplyWide } from '../src/runtime/modular-power.js';
import { checkedNumberModularMultiply, numberOverflow } from '../src/jit/number-arithmetic.js';

it.each([1073741825, 1999998034, 2147483647, 2147483648])(
    'matches exact products of 31-bit residues modulo %s', modulus => {
        const m = BigInt(modulus), half = Math.floor(modulus / 2);
        const edges = [0, 1, 2, modulus - 1, modulus - 2, half - 1, half, half + 1, 65535, 65536, 65537];
        for (const a of edges) for (const b of edges) {
            expect(multiplyWide(a, b, modulus)).toBe(Number(BigInt(a) * BigInt(b) % m));
        }
        let seed = 0x12345678;
        for (let turn = 0; turn < 10000; turn++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const a = seed % modulus;
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            const b = seed % modulus;
            expect(multiplyWide(a, b, modulus)).toBe(Number(BigInt(a) * BigInt(b) % m));
        }
        const signed = [-Number.MAX_SAFE_INTEGER, -modulus, -1, 0, 1, modulus, Number.MAX_SAFE_INTEGER];
        for (const a of signed) for (const b of signed) {
            const product = BigInt(a) * BigInt(b);
            expect(checkedNumberModularMultiply(a, b, modulus)).toBe(Number((product % m + m) % m));
        }
    });
it('retains exact replay outside the supported modulus domain', () => {
    for (const modulus of [0, -1, 2147483649, Number.MAX_SAFE_INTEGER]) {
        let thrown: unknown;
        try { checkedNumberModularMultiply(999999937, 999999929, modulus); }
        catch (failure) { thrown = failure; }
        expect(thrown).toBe(numberOverflow);
    }
});
