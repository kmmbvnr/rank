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
