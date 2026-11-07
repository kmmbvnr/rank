/** Each two-term dot product is exact in binary64 for this modulus bound:
 * 2 * (2^26 - 1)^2 < 2^53. Inputs and outputs are canonical residues.
 * The caller has checked a nonnegative safe-integer exponent. */
export const SMALL_MATRIX_MODULUS = 67108864n;

/** A general 2x2 product, without per-square arrays, Rank wrappers or BigInts.
 * The exponent is divided arithmetically: bitwise shifts would truncate bits
 * above bit 31. Larger numeric domains retain the exact modular interpreter. */
export function modularMatrixPower2(base: Int32Array, exponent: number, modulus: number,
    output: Int32Array, offset: number): void {
    let a = base[0], b = base[1], c = base[2], d = base[3];
    const one = modulus === 1 ? 0 : 1;
    let left = one, upper = 0, lower = 0, right = one;
    for (let power = exponent; power > 0;) {
        if (power % 2 === 1) {
            const nextLeft = (left * a + upper * c) % modulus;
            const nextUpper = (left * b + upper * d) % modulus;
            const nextLower = (lower * a + right * c) % modulus;
            const nextRight = (lower * b + right * d) % modulus;
            left = nextLeft; upper = nextUpper; lower = nextLower; right = nextRight;
        }
        power = Math.floor(power / 2);
        if (power > 0) {
            const middle = b * c, trace = a + d;
            const nextA = (a * a + middle) % modulus;
            const nextD = (d * d + middle) % modulus;
            b = b * trace % modulus; c = c * trace % modulus;
            a = nextA; d = nextD;
        }
    }
    output[offset] = left; output[offset + 1] = upper;
    output[offset + 2] = lower; output[offset + 3] = right;
}
