import { checkpoint } from '../interrupt.js';
import { RankError } from '../errors.js';
import { collectArrayCells } from './array-read.js';
import { multiply } from './modular-power.js';
import { arrayResidues, stepOf, type Residues } from './modular-fold.js';
import { ownedArray, typedArray } from './owned-array.js';
import type { RankArray, RankValue } from './value.js';

/** NTT primes below 2^30 so `multiply` is exact; together they exceed n * m^2 for n <= 2^23, m <= 2^31. */
const PRIMES = [998244353, 469762049, 167772161] as const;
const ROOT = 3;
const MAX_LOG = 23;
/** Below this many cell products the schoolbook sum beats three transforms. */
const SMALL = 4096;

function power(base: number, exponent: number, p: number): number {
    let result = 1;
    let b = base % p;
    for (let e = exponent; e > 0; e = Math.floor(e / 2)) {
        if (e % 2) result = multiply(result, b, p);
        b = multiply(b, b, p);
    }
    return result;
}

const twiddles = new Map<string, Int32Array>();

/** `tw[half + j]` is the j-th power of the primitive root of order `2 * half`. */
function twiddlesOf(p: number, n: number): Int32Array {
    const key = `${p}:${n}`;
    let tw = twiddles.get(key);
    if (tw) return tw;
    tw = new Int32Array(n);
    for (let half = 1; half < n; half *= 2) {
        const w = power(ROOT, (p - 1) / (2 * half), p);
        tw[half] = 1;
        for (let j = 1; j < half; j++) tw[half + j] = multiply(tw[half + j - 1], w, p);
    }
    twiddles.clear();
    twiddles.set(key, tw);
    return tw;
}

function transform(a: Int32Array, p: number, tw: Int32Array): void {
    const n = a.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { const t = a[i]; a[i] = a[j]; a[j] = t; }
    }
    for (let half = 1; half < n; half *= 2) {
        for (let start = 0; start < n; start += 2 * half) {
            for (let j = 0; j < half; j++) {
                const u = a[start + j];
                const v = multiply(a[start + j + half], tw[half + j], p);
                const sum = u + v;
                const diff = u - v;
                a[start + j] = sum >= p ? sum - p : sum;
                a[start + j + half] = diff < 0 ? diff + p : diff;
            }
        }
        checkpoint('transforming', n);
    }
}

/** The product of the residue vectors modulo `p`, as a vector of length `size`. */
function productMod(a: Int32Array, b: Int32Array, p: number, n: number, outLength: number): Int32Array {
    const tw = twiddlesOf(p, n);
    const left = new Int32Array(n);
    for (let i = 0; i < a.length; i++) left[i] = a[i] % p;
    transform(left, p, tw);
    let right = left;
    if (a !== b) {
        right = new Int32Array(n);
        for (let i = 0; i < b.length; i++) right[i] = b[i] % p;
        transform(right, p, tw);
    }
    for (let i = 0; i < n; i++) left[i] = multiply(left[i], right[i], p);
    transform(left, p, tw);
    // The inverse is the forward transform on reversed output, scaled by 1/n.
    const scale = power(n, p - 2, p);
    const out = new Int32Array(outLength);
    out[0] = multiply(left[0], scale, p);
    for (let i = 1; i < outLength; i++) out[i] = multiply(left[n - i], scale, p);
    return out;
}

function mulmod(m: number): (a: number, b: number) => number {
    if (m <= 2 ** 30) return (a, b) => multiply(a, b, m);
    return (a, b) => ((a * (b >>> 16)) % m * 65536 + a * (b & 65535)) % m;
}

/** Schoolbook product of residue vectors, each step reduced modulo `m`. */
function schoolbook(a: Int32Array, b: Int32Array, m: number): Int32Array {
    const out = new Int32Array(a.length + b.length - 1);
    const times = mulmod(m);
    const plus = stepOf('+', m);
    for (let i = 0; i < a.length; i++) {
        checkpoint('convolving', b.length);
        const x = a[i];
        if (x === 0) continue;
        for (let j = 0; j < b.length; j++) out[i + j] = plus(out[i + j], times(x, b[j]));
    }
    return out;
}

/** Combines the three prime residues of each cell into the value modulo `m` (Garner). */
function combine(r: readonly Int32Array[], m: number): Int32Array {
    const [p1, p2, p3] = PRIMES;
    const inv12 = power(p1 % p2, p2 - 2, p2);
    const inv123 = power(multiply(p1 % p3, p2 % p3, p3), p3 - 2, p3);
    const p12 = Number(BigInt(p1) * BigInt(p2) % BigInt(m));
    const p1m = p1 % m;
    const times = mulmod(m);
    const out = new Int32Array(r[0].length);
    for (let i = 0; i < out.length; i++) {
        const x1 = r[0][i];
        let d = r[1][i] - x1 % p2;
        if (d < 0) d += p2;
        const x2 = multiply(d, inv12, p2);
        let e = r[2][i] - x1 % p3;
        if (e < 0) e += p3;
        e -= multiply(x2 % p3, p1 % p3, p3);
        if (e < 0) e += p3;
        const x3 = multiply(e, inv123, p3);
        const sum = x1 % m + times(x2 % m, p1m) % m + times(x3 % m, p12);
        out[i] = sum % m;
    }
    return out;
}

/** Residues of the polynomial product of two vectors modulo `modulus` (1 to 2^31),
 * or nothing when an input is empty or the product is too long for the transform. */
export function modularConvolve(a: Residues, b: Residues, modulus: number): Residues | undefined {
    const x = a.cells;
    const y = b.cells;
    if (a.shape.length !== 1 || b.shape.length !== 1 || x.length === 0 || y.length === 0) return undefined;
    const length = x.length + y.length - 1;
    if (Math.min(x.length, y.length) <= 32 || x.length * y.length <= SMALL) {
        return { cells: schoolbook(x, y, modulus), shape: [length] };
    }
    let n = 1;
    while (n < length) n *= 2;
    if (n > 2 ** MAX_LOG) return undefined;
    const parts = PRIMES.map(p => productMod(x, y, p, n, length));
    return { cells: combine(parts, modulus), shape: [length] };
}

function integerCells(value: RankValue): bigint[] {
    if (typeof value !== 'object' || value === null || !('shape' in value) || value.shape.length !== 1) {
        throw new RankError('convolve expects two integer vectors', 'TypeError');
    }
    const cells = collectArrayCells(value as RankArray);
    if (cells.length === 0) throw new RankError('convolve expects nonempty vectors', 'DimensionMismatch');
    for (const cell of cells) if (typeof cell !== 'bigint') throw new RankError('convolve expects integer cells', 'TypeError');
    return cells as bigint[];
}

/** The exact polynomial product, schoolbook, with arbitrary-precision sums. */
export function convolveExact(left: RankValue, right: RankValue): RankArray {
    const a = integerCells(left);
    const b = integerCells(right);
    const out: bigint[] = new Array(a.length + b.length - 1).fill(0n);
    for (let i = 0; i < a.length; i++) {
        checkpoint('convolving', b.length);
        const x = a[i];
        if (x === 0n) continue;
        for (let j = 0; j < b.length; j++) out[i + j] += x * b[j];
    }
    return ownedArray(out);
}

/** `(left convolve right) mod modulus` without forming the exact product, or nothing if declined. */
export function convolveModular(left: RankValue, right: RankValue, modulus: bigint): RankArray | undefined {
    if (typeof modulus !== 'bigint') return undefined;
    for (const side of [left, right]) {
        if (typeof side !== 'object' || side === null || !('shape' in side) || side.shape.length !== 1) return undefined;
    }
    const a = arrayResidues(left as RankArray, modulus);
    const b = a && arrayResidues(right as RankArray, modulus);
    const product = a && b && modularConvolve(a, b, Number(modulus));
    return product && typedArray(product.cells, product.shape);
}
