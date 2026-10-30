import { checkpoint } from '../interrupt.js';
import { collectArrayCells } from './array-read.js';
import { float64Cells, integer32Cells, typedArray, typedElementKind } from './owned-array.js';
import type { RankArray } from './value.js';

type Keys = Float64Array | Int32Array;

/** Stable merge of two sorted runs of positions; `down` keeps ties in order. */
function mergeRuns(keys: Keys, from: Uint32Array, to: Uint32Array, lo: number, mid: number, hi: number, down: boolean) {
    let i = lo, j = mid, k = lo;
    if (down) {
        while (i < mid && j < hi) to[k++] = keys[from[j]] > keys[from[i]] ? from[j++] : from[i++];
    } else {
        while (i < mid && j < hi) to[k++] = keys[from[j]] < keys[from[i]] ? from[j++] : from[i++];
    }
    while (i < mid) to[k++] = from[i++];
    while (j < hi) to[k++] = from[j++];
}

/** Stable order of `keys[0..n)`; `a` and `b` are scratch of length n. */
function orderRow(keys: Keys, n: number, down: boolean, a: Uint32Array, b: Uint32Array): Uint32Array {
    for (let i = 0; i < n; i++) a[i] = i;
    // Insertion sort short runs, then merge them bottom-up.
    const run = 8;
    for (let lo = 0; lo < n; lo += run) {
        const hi = Math.min(lo + run, n);
        for (let i = lo + 1; i < hi; i++) {
            const p = a[i], x = keys[p];
            let j = i - 1;
            if (down) while (j >= lo && keys[a[j]] < x) { a[j + 1] = a[j]; j--; }
            else while (j >= lo && keys[a[j]] > x) { a[j + 1] = a[j]; j--; }
            a[j + 1] = p;
        }
    }
    let from = a, to = b;
    for (let width = run; width < n; width *= 2) {
        for (let lo = 0; lo < n; lo += 2 * width) {
            const mid = Math.min(lo + width, n), hi = Math.min(lo + 2 * width, n);
            mergeRuns(keys, from, to, lo, mid, hi, down);
        }
        [from, to] = [to, from];
    }
    return from;
}

/** Stored buffers are borrowed; lazy cells are read once, in bulk, and kept
 * only if all are reals or all are integers that fit in 32 bits. */
function keyCells(value: RankArray): Keys | undefined {
    const kind = typedElementKind(value);
    const stored = kind === 'real' ? float64Cells(value) : kind === 'integer' ? integer32Cells(value) : undefined;
    if (stored) return stored;
    const items = collectArrayCells(value);
    const first = items[0];
    if (typeof first === 'number') {
        const out = new Float64Array(items.length);
        for (let i = 0; i < out.length; i++) {
            const x = items[i];
            if (typeof x !== 'number') return undefined;
            out[i] = x;
        }
        return out;
    }
    if (typeof first !== 'bigint') return undefined;
    const out = new Int32Array(items.length);
    for (let i = 0; i < out.length; i++) {
        const x = items[i];
        if (typeof x !== 'bigint' || x < -2147483648n || x > 2147483647n) return undefined;
        out[i] = Number(x);
    }
    return out;
}

/** Row-wise argsort of stored real or Int32 cells; undefined declines. NaN
 * cells keep the ordinary path, which defines their order. */
export function argsortStoredAxis(value: RankArray, axis: number, down: boolean): RankArray | undefined {
    if (value.columnNames) return undefined;
    const cells = keyCells(value);
    if (!cells) return undefined;
    const shape = value.shape, n = shape[axis];
    let inner = 1;
    for (let d = axis + 1; d < shape.length; d++) inner *= shape[d];
    const size = cells.length, outer = n * inner ? size / (n * inner) : 0;
    const out = new Int32Array(size);
    const row: Keys = cells instanceof Float64Array ? new Float64Array(n) : new Int32Array(n);
    const a = new Uint32Array(n), b = new Uint32Array(n);
    for (let o = 0; o < outer; o++) {
        checkpoint('sorting', n);
        for (let i = 0; i < inner; i++) {
            const base = o * n * inner + i;
            for (let k = 0; k < n; k++) {
                const x = cells[base + k * inner];
                if (x !== x) return undefined;
                row[k] = x;
            }
            const order = orderRow(row, n, down, a, b);
            for (let k = 0; k < n; k++) out[base + k * inner] = order[k];
        }
    }
    return typedArray(out, [...shape]);
}

const INT32_MAX = 2147483647;

/** Prefix `+`, `max` or `min` along an axis of stored Int32 cells. Sums stay
 * exact in a double for axes under 2^21 cells; wider results become Int64. */
export function scanInt32Axis(op: '+' | 'max' | 'min', value: RankArray, shape: readonly number[], axis: number): RankArray | undefined {
    const cells = integer32Cells(value);
    const length = shape[axis];
    if (!cells || value.columnNames || length > 2 ** 21) return undefined;
    let inner = 1;
    for (let d = axis + 1; d < shape.length; d++) inner *= shape[d];
    const out = new Float64Array(cells.length);
    const block = length * inner;
    let wide = false;
    for (let start = 0; start < out.length && length > 0; start += block) {
        checkpoint('scanning', block);
        for (let i = 0; i < inner; i++) out[start + i] = cells[start + i];
        for (let at = start + inner; at < start + block; at += inner) {
            const end = at + inner;
            if (op === '+') for (let i = at; i < end; i++) out[i] = out[i - inner] + cells[i];
            else if (op === 'max') for (let i = at; i < end; i++) { const a = out[i - inner], b = cells[i]; out[i] = a > b ? a : b; }
            else for (let i = at; i < end; i++) { const a = out[i - inner], b = cells[i]; out[i] = a < b ? a : b; }
        }
    }
    if (op === '+') for (let i = 0; i < out.length; i++) {
        const x = out[i];
        if (x > INT32_MAX || x < -INT32_MAX - 1) { wide = true; break; }
    }
    if (!wide) return typedArray(Int32Array.from(out), [...shape]);
    return typedArray(BigInt64Array.from(out, x => BigInt(x)), [...shape]);
}

/** `sum` along one axis of stored real cells, adding in axis order from 0 as
 * the generic fold does. An empty axis keeps the integer-zero seed's path. */
export function sumRealAxis(value: RankArray, axis: number): RankArray | number | undefined {
    const kind = typedElementKind(value);
    const cells = kind === 'real' && !value.columnNames ? float64Cells(value) : undefined;
    const length = value.shape[axis];
    if (!cells || !length || cells.length === 0) return undefined;
    let inner = 1;
    for (let d = axis + 1; d < value.shape.length; d++) inner *= value.shape[d];
    const outer = cells.length / (length * inner);
    const totals = new Float64Array(outer * inner);
    for (let block = 0; block < outer; block++) {
        checkpoint('summing real axis', length * inner);
        const target = block * inner;
        if (inner === 1) {
            let total = 0;
            for (let i = block * length, end = i + length; i < end; i++) total += cells[i];
            totals[target] = total;
            continue;
        }
        for (let row = 0; row < length; row++) {
            const source = (block * length + row) * inner;
            for (let lane = 0; lane < inner; lane++) totals[target + lane] += cells[source + lane];
        }
    }
    const shape = value.shape.filter((_, index) => index !== axis);
    return shape.length ? typedArray(totals, shape) : totals[0];
}
