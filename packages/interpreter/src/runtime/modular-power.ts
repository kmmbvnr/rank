import { checkpoint } from '../interrupt.js';

/** Exact modular multiplication for 0 <= a,b < modulus <= 2^30.
 * The floating quotient can differ from floor(a*b/modulus) by at most one.
 * imul recovers the exact low 32 bits of a*b - quotient*modulus. That
 * difference lies in (-modulus, 2*modulus), so its signed 32-bit value is
 * unambiguous. One correction then gives the exact nonnegative residue. */
export function multiply(a: number, b: number, modulus: number): number {
    const quotient = (a * b / modulus) | 0;
    const remainder = (Math.imul(a, b) - Math.imul(quotient, modulus)) | 0;
    return remainder < 0 ? remainder + modulus : remainder >= modulus ? remainder - modulus : remainder;
}

let lastBase = -1;
let lastModulus = -1;
let squares: Float64Array | undefined;

/** Safe integer inputs, a nonnegative exponent and 0 < modulus <= 2^30.
 * Larger domains retain the arbitrary-precision modularPower implementation. */
export function safeIntegerModularPower(base: number, exponent: number, modulus: number): number {
    if (exponent <= 4294967295) {
        const reduced = base >= 0 && base < modulus ? base : ((base % modulus) + modulus) % modulus;
        // A run of calls with one base and modulus shares its squarings.
        if (reduced === lastBase && modulus === lastModulus) {
            if (!squares) {
                squares = new Float64Array(32);
                squares[0] = reduced;
                for (let bit = 1; bit < 32; bit++) squares[bit] = multiply(squares[bit - 1], squares[bit - 1], modulus);
            }
            let result = modulus === 1 ? 0 : 1;
            for (let remaining = exponent >>> 0, bit = 0; remaining > 0; remaining >>>= 1, bit++) {
                if (remaining & 1) result = multiply(result, squares[bit], modulus);
            }
            return result;
        }
        lastBase = reduced;
        lastModulus = modulus;
        squares = undefined;
    }
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

/** Powers of four bases with one shared exponent in lockstep. The squaring
 * chains are independent, so the processor overlaps their latencies.
 * Each base is a residue and 0 < modulus <= 2^30. */
export function modularPowerQuad(bases: Int32Array, offset: number, stride: number,
    exponent: number, modulus: number, out: Int32Array, at: number): void {
    let f0 = bases[offset], f1 = bases[offset + stride];
    let f2 = bases[offset + 2 * stride], f3 = bases[offset + 3 * stride];
    const one = modulus === 1 ? 0 : 1;
    let r0 = one, r1 = one, r2 = one, r3 = one;
    for (let power = exponent >>> 0; power > 0;) {
        if (power & 1) {
            r0 = multiply(r0, f0, modulus); r1 = multiply(r1, f1, modulus);
            r2 = multiply(r2, f2, modulus); r3 = multiply(r3, f3, modulus);
        }
        power >>>= 1;
        if (power > 0) {
            f0 = multiply(f0, f0, modulus); f1 = multiply(f1, f1, modulus);
            f2 = multiply(f2, f2, modulus); f3 = multiply(f3, f3, modulus);
        }
    }
    out[at] = r0; out[at + 1] = r1; out[at + 2] = r2; out[at + 3] = r3;
}
