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
