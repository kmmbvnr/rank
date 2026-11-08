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

/** Exact modular multiplication for 0 <= a,b < modulus <= 2^31.
 * Rounding a*b/modulus gives a centered difference of at most roughly
 * modulus/2. Floating quotient error is below 2^-20 in this domain, so
 * the difference stays strictly within signed Int32. imul recovers its
 * exact low bits; adding the modulus once gives the nonnegative residue. */
export function multiplyWide(a: number, b: number, modulus: number): number {
    const quotient = Math.round(a * b / modulus);
    const remainder = (Math.imul(a, b) - Math.imul(quotient, modulus)) | 0;
    return remainder < 0 ? remainder + modulus : remainder;
}

let lastBase = -1;
let lastModulus = -1;
let squares: Float64Array | undefined;

/** Safe integer inputs, a nonnegative exponent and 0 < modulus <= 2^31.
 * Larger domains retain the arbitrary-precision modularPower implementation. */
export function safeIntegerModularPower(base: number, exponent: number, modulus: number): number {
    if (modulus > 2 ** 30) return wideIntegerModularPower(base, exponent, modulus);
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

/** Keep the established <=2^30 cache and four-lane kernels unchanged.
 * The wider domain uses the already-proved centered low-word multiplier. */
function wideIntegerModularPower(base: number, exponent: number, modulus: number): number {
    let factor = base >= 0 && base < modulus ? base : ((base % modulus) + modulus) % modulus;
    let power = exponent, result = 1;
    while (power > 4294967295) {
        checkpoint('computing numbers', 1024);
        if (power % 2 === 1) result = multiplyWide(result, factor, modulus);
        power = Math.floor(power / 2);
        factor = multiplyWide(factor, factor, modulus);
    }
    let remaining = power >>> 0;
    while (remaining > 0) {
        checkpoint('computing numbers', 1024);
        if (remaining & 1) result = multiplyWide(result, factor, modulus);
        remaining >>>= 1;
        if (remaining > 0) factor = multiplyWide(factor, factor, modulus);
    }
    return result;
}

/** Powers of four bases with one shared exponent in lockstep. The squaring
 * chains are independent, so the processor overlaps their latencies.
 * Each base is a residue and 0 < modulus <= 2^31. */
export function modularPowerQuad(bases: Int32Array, offset: number, stride: number,
    exponent: number, modulus: number, out: Int32Array, at: number): void {
    if (modulus > 2 ** 30) return modularPowerWideQuad(bases, offset, stride, exponent, modulus, out, at);
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

function modularPowerWideQuad(bases: Int32Array, offset: number, stride: number,
    exponent: number, modulus: number, out: Int32Array, at: number): void {
    let f0 = bases[offset], f1 = bases[offset + stride];
    let f2 = bases[offset + 2 * stride], f3 = bases[offset + 3 * stride];
    const one = modulus === 1 ? 0 : 1;
    let r0 = one, r1 = one, r2 = one, r3 = one;
    for (let power = exponent >>> 0; power > 0;) {
        if (power & 1) {
            r0 = multiplyWide(r0, f0, modulus); r1 = multiplyWide(r1, f1, modulus);
            r2 = multiplyWide(r2, f2, modulus); r3 = multiplyWide(r3, f3, modulus);
        }
        power >>>= 1;
        if (power > 0) {
            f0 = multiplyWide(f0, f0, modulus); f1 = multiplyWide(f1, f1, modulus);
            f2 = multiplyWide(f2, f2, modulus); f3 = multiplyWide(f3, f3, modulus);
        }
    }
    out[at] = r0; out[at + 1] = r1; out[at + 2] = r2; out[at + 3] = r3;
}


/** Nonnegative Int32 exponents of one base. Independent accumulators overlap
 * multiplication latencies while all four lanes share one squaring table. */
export function modularExponentQuad(exponents: Int32Array, offset: number, stride: number,
    squares: Int32Array, modulus: number, out: Int32Array, at: number): void {
    let e0 = exponents[offset], e1 = exponents[offset + stride];
    let e2 = exponents[offset + 2 * stride], e3 = exponents[offset + 3 * stride];
    const one = modulus === 1 ? 0 : 1;
    let r0 = one, r1 = one, r2 = one, r3 = one;
    for (let bit = 0; (e0 | e1 | e2 | e3) !== 0; bit++) {
        const factor = squares[bit];
        if (e0 & 1) r0 = multiply(r0, factor, modulus);
        if (e1 & 1) r1 = multiply(r1, factor, modulus);
        if (e2 & 1) r2 = multiply(r2, factor, modulus);
        if (e3 & 1) r3 = multiply(r3, factor, modulus);
        e0 >>>= 1; e1 >>>= 1; e2 >>>= 1; e3 >>>= 1;
    }
    out[at] = r0; out[at + 1] = r1; out[at + 2] = r2; out[at + 3] = r3;
}
