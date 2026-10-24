import { checkpoint } from './interrupt.js';

/** Exact modular multiplication for 0 <= a,b < modulus <= 2^30.
 * The floating quotient can differ from floor(a*b/modulus) by at most one.
 * imul recovers the exact low 32 bits of a*b - quotient*modulus. That
 * difference lies in (-modulus, 2*modulus), so its signed 32-bit value is
 * unambiguous. One correction then gives the exact nonnegative residue. */
function multiply(a: number, b: number, modulus: number): number {
    const quotient = (a * b / modulus) | 0;
    const remainder = (Math.imul(a, b) - Math.imul(quotient, modulus)) | 0;
    return remainder < 0 ? remainder + modulus : remainder >= modulus ? remainder - modulus : remainder;
}

/** Safe integer inputs, a nonnegative exponent and 0 < modulus <= 2^30.
 * Larger domains retain the arbitrary-precision modularPower implementation. */
export function safeIntegerModularPower(base: number, exponent: number, modulus: number): number {
    let factor = base >= 0 && base < modulus ? base : ((base % modulus) + modulus) % modulus;
    let power = exponent;
    let result = modulus === 1 ? 0 : 1;
    while (power > 4294967295) {
        checkpoint('computing numbers', 1024);
        if (power % 2 === 1) result = multiply(result, factor, modulus);
        power = Math.floor(power / 2);
        factor = multiply(factor, factor, modulus);
    }
    // Keep the common exponent range in unsigned registers. A signed shift
    // would lose bit 31; shifting wide exponents here would lose high bits.
    let remaining = power >>> 0;
    while (remaining > 0) {
        checkpoint('computing numbers', 1024);
        if (remaining & 1) result = multiply(result, factor, modulus);
        remaining >>>= 1;
        if (remaining > 0) factor = multiply(factor, factor, modulus);
    }
    return result;
}
