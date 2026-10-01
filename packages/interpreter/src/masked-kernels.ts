import {
    allPresent, allValid, float64Cells, hasMaskedCells, isPresentAt, maskedArray, maskedCells, ownedArray,
    typedArray, validityWords,
} from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { MISSING, type RankArray, type RankValue } from './value.js';

/** Codes of the real operations, as in `REAL_CODES`. */
const ADD = 0, SUBTRACT = 1, MULTIPLY = 2, LESS = 5, GREATER = 6, AT_MOST = 7, AT_LEAST = 8;
const CHUNK = 4096;

interface Operand {
    readonly values: Float64Array | number;
    /** Undefined when every cell has a value. */
    readonly validity?: Uint32Array;
}

function operand(value: RankValue): Operand | undefined {
    if (typeof value === 'number') return { values: value };
    if (typeof value !== 'object' || value.kind !== 'array') return undefined;
    const masked = maskedCells(value);
    if (masked) return masked;
    const values = float64Cells(value as RankArray);
    return values ? { values } : undefined;
}

/**
 * An elementwise real operation when one operand holds cells without a value:
 * the values are computed for every cell and the validity words are combined
 * with one AND per 32 cells, so there is no per-cell branch and no exception.
 * Declines for anything it does not cover (other shapes, integers, a scalar
 * `.NA`), and the general path then gives the same answer one cell at a time.
 */
export function mapMaskedArrays(left: RankValue, right: RankValue, code: number): RankArray | undefined {
    const leftArray = typeof left === 'object' && left.kind === 'array' ? left as RankArray : undefined;
    const rightArray = typeof right === 'object' && right.kind === 'array' ? right as RankArray : undefined;
    if (!(leftArray && hasMaskedCells(leftArray)) && !(rightArray && hasMaskedCells(rightArray))) return undefined;
    if (leftArray && rightArray
        && (leftArray.shape.length !== rightArray.shape.length
            || leftArray.shape.some((size, axis) => size !== rightArray.shape[axis]))) return undefined;
    const a = operand(left);
    const b = operand(right);
    if (!a || !b) return undefined;
    const shape = (leftArray ?? rightArray)!.shape;
    const size = shape.reduce((product, dimension) => product * dimension, 1);

    const validity = combine(a.validity, b.validity, size);
    if (code < 0 || code === 4 || code > AT_LEAST) return undefined;
    if (code >= LESS) return compare(code, size, a.values, b.values, validity, shape);
    const out = new Float64Array(size);
    const x = a.values, y = b.values;
    for (let start = 0; start < size; start += CHUNK) {
        checkpoint('computing array');
        const end = Math.min(size, start + CHUNK);
        if (typeof x !== 'number' && typeof y !== 'number') {
            switch (code) {
                case ADD: for (let i = start; i < end; i += 1) out[i] = x[i] + y[i]; break;
                case SUBTRACT: for (let i = start; i < end; i += 1) out[i] = x[i] - y[i]; break;
                case MULTIPLY: for (let i = start; i < end; i += 1) out[i] = x[i] * y[i]; break;
                default:
                    for (let i = start; i < end; i += 1) {
                        // A cell without a value never divides; only a real zero divisor is an error.
                        if (y[i] === 0 && isPresentAt(validity, i)) return undefined;
                        out[i] = x[i] / y[i];
                    }
            }
        } else if (typeof y === 'number' && typeof x !== 'number' && code <= MULTIPLY) {
            switch (code) {
                case ADD: for (let i = start; i < end; i += 1) out[i] = x[i] + y; break;
                case SUBTRACT: for (let i = start; i < end; i += 1) out[i] = x[i] - y; break;
                default: for (let i = start; i < end; i += 1) out[i] = x[i] * y;
            }
        } else if (typeof x === 'number' && typeof y !== 'number' && code <= MULTIPLY) {
            switch (code) {
                case ADD: for (let i = start; i < end; i += 1) out[i] = x + y[i]; break;
                case SUBTRACT: for (let i = start; i < end; i += 1) out[i] = x - y[i]; break;
                default: for (let i = start; i < end; i += 1) out[i] = x * y[i];
            }
        } else {
            for (let i = start; i < end; i += 1) {
                const p = typeof x === 'number' ? x : x[i];
                const q = typeof y === 'number' ? y : y[i];
                switch (code) {
                    case ADD: out[i] = p + q; break;
                    case SUBTRACT: out[i] = p - q; break;
                    case MULTIPLY: out[i] = p * q; break;
                    default:
                        if (q === 0 && isPresentAt(validity, i)) return undefined;
                        out[i] = p / q;
                }
            }
        }
    }
    return allValid(validity, size) ? typedArray(out, shape) : maskedArray(out, validity, shape);
}

function combine(a: Uint32Array | undefined, b: Uint32Array | undefined, size: number): Uint32Array {
    if (!a && !b) return allPresent(size);
    if (!a || !b) return (a ?? b)!.slice();
    const out = new Uint32Array(validityWords(size));
    for (let word = 0; word < out.length; word += 1) out[word] = a[word] & b[word];
    return out;
}

/** A comparison gives a boolean per cell, or `.NA` where either side had no value. */
function compare(
    code: number, size: number, x: Float64Array | number, y: Float64Array | number,
    validity: Uint32Array, shape: readonly number[],
): RankArray {
    const cells: RankValue[] = new Array(size);
    for (let start = 0; start < size; start += CHUNK) {
        checkpoint('computing array');
        const end = Math.min(size, start + CHUNK);
        for (let i = start; i < end; i += 1) {
            if (!isPresentAt(validity, i)) { cells[i] = MISSING; continue; }
            const p = typeof x === 'number' ? x : x[i];
            const q = typeof y === 'number' ? y : y[i];
            cells[i] = code === LESS ? p < q : code === GREATER ? p > q : code === AT_MOST ? p <= q : p >= q;
        }
    }
    return ownedArray(cells, shape);
}

/** The values of a real masked array with a value, in order, without reading the plain view. */
export function presentReals(value: RankArray): Float64Array | undefined {
    const masked = maskedCells(value);
    if (!masked) return undefined;
    const { values, validity } = masked;
    const out = new Float64Array(values.length);
    let count = 0;
    for (let index = 0; index < values.length; index += 1) {
        if (isPresentAt(validity, index)) out[count++] = values[index];
    }
    return out.subarray(0, count);
}

/** Sum of the cells with a value. As for any real array of no cells it is integer zero. */
export function sumMasked(value: RankArray): number | bigint | undefined {
    const masked = maskedCells(value);
    if (!masked) return undefined;
    const { values, validity } = masked;
    let total = 0;
    let any = false;
    for (let index = 0; index < values.length; index += 1) {
        if (isPresentAt(validity, index)) { total += values[index]; any = true; }
    }
    return any ? total : 0n;
}

/** `min` or `max` of the cells with a value, or undefined when none has one. */
export function extremeMasked(
    value: RankArray, replaces: (candidate: number, current: number) => boolean,
): { found: boolean; result: number } | undefined {
    const masked = maskedCells(value);
    if (!masked) return undefined;
    const { values, validity } = masked;
    let result = 0;
    let found = false;
    for (let index = 0; index < values.length; index += 1) {
        if (!isPresentAt(validity, index)) continue;
        if (!found || replaces(values[index], result)) { result = values[index]; found = true; }
    }
    return { found, result };
}
