import { multiply } from '../runtime/modular-power.js';

// Internal replay signal, never a Rank error or a numeric value.
export const numberOverflow = {};

/** Safe integer operands; unsupported moduli replay with exact arithmetic. */
export function checkedNumberModularMultiply(a: number, b: number, modulus: number): number {
    if (!(modulus > 0 && modulus <= 2 ** 30)) throw numberOverflow;
    const x = a >= 0 && a < modulus ? a : ((a % modulus) + modulus) % modulus;
    const y = b >= 0 && b < modulus ? b : ((b % modulus) + modulus) % modulus;
    return multiply(x, y, modulus);
}

/** Repeated squaring uses only checked integer products. JS ** can round a
 * mathematical integer to a different safe integer, so checking its result alone
 * would not establish exactness. Negative exponents replay with real semantics. */
export function checkedNumberPower(base: number, exponent: number): number {
    if (exponent < 0) throw numberOverflow;
    let result = 1;
    while (exponent > 0) {
        if (exponent % 2 !== 0) result = checkedProduct(result, base);
        exponent = Math.floor(exponent / 2);
        if (exponent > 0) base = checkedProduct(base, base);
    }
    return result;
}
function checkedProduct(a: number, b: number): number {
    const value = a * b;
    if (!Number.isSafeInteger(value)) throw numberOverflow;
    return value;
}
