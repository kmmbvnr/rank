import { checkpoint, demandBudgetEnabled, privateLoopPolling } from '../interrupt.js';
import { collectArrayCells } from './array-read.js';
import { consumeSafeIntegerBuffer, float64Cells, integer32Cells, integer64Cells, typedArray, typedElementKind } from './owned-array.js';
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
    // Reverse only strictly descending runs so equal keys keep their order.
    const before = (x: number, y: number) => down ? keys[x] > keys[y] : keys[x] < keys[y];
    let runs = [0];
    for (let lo = 0; lo < n;) {
        let hi = lo + 1;
        if (hi < n && before(a[hi], a[lo])) {
            while (hi < n && before(a[hi], a[hi - 1])) hi++;
            for (let l = lo, r = hi - 1; l < r; l++, r--) {
                const saved = a[l]; a[l] = a[r]; a[r] = saved;
            }
        } else {
            while (hi < n && !before(a[hi], a[hi - 1])) hi++;
        }
        runs.push(hi);
        lo = hi;
    }
    let from = a, to = b;
    while (runs.length > 2) {
        const next = [0];
        for (let i = 0; i < runs.length - 1; i += 2) {
            const lo = runs[i], mid = runs[i + 1], hi = runs[i + 2] ?? mid;
            mergeRuns(keys, from, to, lo, mid, hi, down);
            next.push(hi);
        }
        [from, to] = [to, from];
        runs = next;
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

/** Completed Int32 cells can fold any axis directly into compact storage.
 * Empty reductions retain their ordinary lazy errors. No cells are boxed. */
export function extremeIntegerAxis(value: RankArray, axis: number, operation: 'min' | 'max'): RankArray | bigint | undefined {
    if (!privateLoopPolling() || value.columnNames || value.itemAt !== undefined) return undefined;
    const cells = integer32Cells(value), length = value.shape[axis];
    if (!cells || !length) return undefined;
    const inner = value.shape.slice(axis + 1).reduce((n, d) => n * d, 1);
    const shape = value.shape.filter((_, index) => index !== axis);
    const size = shape.reduce((n, d) => n * d, 1);
    const out = new Int32Array(size);
    const outer = inner ? size / inner : 0;
    for (let block = 0; block < outer; block++) {
        const source = block * length * inner, target = block * inner;
        if (inner === 1) {
            let result = cells[source];
            for (let start = 0; start < length; start += 4096) {
                const end = Math.min(length, start + 4096);
                checkpoint('reducing integer axis', end - start);
                if (operation === 'min') for (let i = start; i < end; i++) {
                    if (cells[source + i] < result) result = cells[source + i];
                }
                else for (let i = start; i < end; i++) {
                    if (cells[source + i] > result) result = cells[source + i];
                }
            }
            out[target] = result;
            continue;
        }
        for (let lane = 0; lane < inner; lane += 4096) {
            const end = Math.min(inner, lane + 4096);
            checkpoint('reducing integer axis', end - lane);
            out.set(cells.subarray(source + lane, source + end), target + lane);
        }
        for (let row = 1; row < length; row++) {
            const at = source + row * inner;
            for (let lane = 0; lane < inner; lane += 4096) {
                const end = Math.min(inner, lane + 4096);
                checkpoint('reducing integer axis', end - lane);
                if (operation === 'min') for (let i = lane; i < end; i++) {
                    if (cells[at + i] < out[target + i]) out[target + i] = cells[at + i];
                }
                else for (let i = lane; i < end; i++) {
                    if (cells[at + i] > out[target + i]) out[target + i] = cells[at + i];
                }
            }
        }
    }
    return shape.length ? typedArray(out, shape) : BigInt(out[0]);
}

/** Scalar min/max folds over stored reals, preserving axis order and the
 * first value on ties or unordered comparisons (including NaN and -0).
 * Empty axes retain the ordinary fold's deferred errors. */
export function extremeRealAxis(value: RankArray, axis: number, operation: 'min' | 'max'): RankArray | number | undefined {
    if (!privateLoopPolling() || value.columnNames || typedElementKind(value) !== 'real') return undefined;
    const cells = float64Cells(value);
    const length = value.shape[axis];
    if (!cells || !length) return undefined;
    let inner = 1;
    for (let d = axis + 1; d < value.shape.length; d++) inner *= value.shape[d];
    const shape = value.shape.filter((_, index) => index !== axis);
    const size = shape.reduce((n, d) => n * d, 1);
    const out = new Float64Array(size);
    const outer = inner ? size / inner : 0;
    for (let block = 0; block < outer; block++) {
        const target = block * inner;
        const source = block * length * inner;
        if (inner === 1) {
            checkpoint('reducing real axis');
            let result = cells[source];
            for (let at = source + 1; at < source + length; at += 4096) {
                const end = Math.min(source + length, at + 4096);
                checkpoint('reducing real axis', end - at);
                if (operation === 'min') for (let i = at; i < end; i++) {
                    if (cells[i] < result) result = cells[i];
                }
                else for (let i = at; i < end; i++) {
                    if (cells[i] > result) result = cells[i];
                }
            }
            out[target] = result;
            continue;
        }
        for (let lane = 0; lane < inner; lane += 4096) {
            const end = Math.min(inner, lane + 4096);
            checkpoint('reducing real axis', end - lane);
            out.set(cells.subarray(source + lane, source + end), target + lane);
        }
        for (let row = 1; row < length; row++) {
            const at = source + row * inner;
            for (let lane = 0; lane < inner; lane += 4096) {
                const end = Math.min(inner, lane + 4096);
                checkpoint('reducing real axis', end - lane);
                if (operation === 'min') for (let i = lane; i < end; i++) {
                    const x = cells[at + i];
                    if (x < out[target + i]) out[target + i] = x;
                }
                else for (let i = lane; i < end; i++) {
                    const x = cells[at + i];
                    if (x > out[target + i]) out[target + i] = x;
                }
            }
        }
    }
    return shape.length ? typedArray(out, shape) : out[0];
}

/** Min/max of a stored integer vector without boxing its cells. Equal values
 * are indistinguishable, so no tie order is needed; empty vectors decline. */
export function extremeIntegerVector(value: RankArray, operation: 'min' | 'max'): bigint | undefined {
    if (!privateLoopPolling() || value.columnNames || value.shape.length !== 1) return undefined;
    const cells = integer32Cells(value) ?? integer64Cells(value);
    if (!cells?.length) return undefined;
    let result = cells[0] as number | bigint;
    for (let at = 1; at < cells.length; at += 4096) {
        const end = Math.min(cells.length, at + 4096);
        checkpoint('reducing integer vector', end - at);
        const part = cells.subarray(at, end) as Int32Array | BigInt64Array;
        if (operation === 'min') for (let i = 0; i < part.length; i++) { if (part[i] < result) result = part[i]; }
        else for (let i = 0; i < part.length; i++) { if (part[i] > result) result = part[i]; }
    }
    return BigInt(result);
}

/** Seeded integer-vector sums keep their seed and prefixes packed. A private
 * unsafe prefix retries the ordinary exact scan; budgets retain that path. */
export function scanInt32Seeded(value: RankArray, seed: bigint): RankArray | undefined {
    if (!privateLoopPolling() || demandBudgetEnabled() || value.shape.length !== 1 || value.columnNames) return undefined;
    const cells = integer32Cells(value), initial = Number(seed);
    if (!cells || value.shape[0] !== cells.length || !Number.isSafeInteger(initial)) return undefined;
    let out: Int32Array | Float64Array = initial === (initial | 0)
        ? new Int32Array(cells.length + 1) : new Float64Array(cells.length + 1);
    let sum = out[0] = initial;
    for (let start = 0; start < cells.length; start += 4096) {
        const end = Math.min(cells.length, start + 4096);
        checkpoint('scanning', end - start);
        for (let at = start; at < end; at++) {
            sum += cells[at];
            if (!Number.isSafeInteger(sum)) return undefined;
            if (out instanceof Int32Array && sum !== (sum | 0)) {
                const wide = new Float64Array(cells.length + 1);
                wide.set(out.subarray(0, at + 1));
                out = wide;
            }
            out[at + 1] = sum;
        }
    }
    return typedArray(out instanceof Int32Array ? out : consumeSafeIntegerBuffer(out), [cells.length + 1]);
}

/** Stored Int64 prefixes stay packed until a prefix needs arbitrary precision.
 * Decline before publishing on overflow; the ordinary scan then remains exact. */
export function scanInt64(value: RankArray): RankArray | undefined {
    if (value.shape.length !== 1 || value.columnNames || !privateLoopPolling()) return undefined;
    const cells = integer64Cells(value);
    if (!cells) return undefined;
    const out = new BigInt64Array(cells.length);
    let sum = 0n;
    for (let start = 0; start < cells.length; start += 4096) {
        const end = Math.min(start + 4096, cells.length);
        checkpoint('scanning', end - start);
        for (let i = start; i < end; i++) {
            sum += cells[i];
            if (sum < -9223372036854775808n || sum > 9223372036854775807n) return undefined;
            out[i] = sum;
        }
    }
    return typedArray(out, value.shape);
}

/** Running sum of a stored real vector, left to right as the ordinary scan
 * adds. The first cell is kept as is (so -0 survives); non-finite sums
 * propagate exactly as they do for boxed reals. */
export function scanFloat64(value: RankArray): RankArray | undefined {
    if (value.shape.length !== 1 || value.columnNames || !privateLoopPolling() || typedElementKind(value) !== 'real') return undefined;
    const cells = float64Cells(value);
    if (!cells?.length) return undefined;
    const out = new Float64Array(cells.length);
    let sum = out[0] = cells[0];
    for (let start = 1; start < cells.length; start += 4096) {
        const end = Math.min(start + 4096, cells.length);
        checkpoint('scanning', end - start);
        for (let i = start; i < end; i++) out[i] = sum += cells[i];
    }
    return typedArray(out, value.shape);
}

/** Prefix `+`, `*`, `max` or `min` along an axis of stored Int32 cells. Axes up to
 * 2^21 cells have safe Number sums even for worst-case Int32 inputs. Longer
 * axes and all products check each prefix; an unsafe result leaves exact
 * traversal to the caller. Wider safe results become Int64, never reals. */
export function scanInt32Axis(op: '+' | '*' | 'max' | 'min', value: RankArray, shape: readonly number[], axis: number): RankArray | undefined {
    const cells = integer32Cells(value);
    const length = shape[axis];
    if (!cells || value.columnNames || !privateLoopPolling()) return undefined;
    let inner = 1;
    for (let d = axis + 1; d < shape.length; d++) inner *= shape[d];
    // Most prefix counters stay in Int32. Build them directly, avoiding a
    // double scratch array, a width pass and a final narrowing copy. A private
    // failed attempt may replay, so bounded demand keeps the ordinary path.
    if (op === '+' && inner === 1 && length > 0 && !demandBudgetEnabled()) {
        const compact = new Int32Array(cells.length);
        let fits = true;
        outer: for (let row = 0; row < cells.length; row += length) {
            let sum = 0;
            for (let start = row; start < row + length; start += 4096) {
                const end = Math.min(row + length, start + 4096);
                checkpoint('scanning', end - start);
                for (let i = start; i < end; i++) {
                    sum += cells[i];
                    if (sum !== (sum | 0)) { fits = false; break outer; }
                    compact[i] = sum;
                }
            }
        }
        if (fits) return typedArray(compact, [...shape]);
    }
    const out = op === 'max' || op === 'min' ? new Int32Array(cells.length) : new Float64Array(cells.length);
    const block = length * inner;
    let wide = false;
    for (let start = 0; start < out.length && length > 0; start += block) {
        for (let at = start; at < start + inner; at += 4096) {
            const end = Math.min(start + inner, at + 4096);
            checkpoint('scanning', end - at);
            for (let i = at; i < end; i++) out[i] = cells[i];
        }
        for (let at = start + inner; at < start + block; at += 4096) {
            const end = Math.min(start + block, at + 4096);
            checkpoint('scanning', end - at);
            if (op === '+') for (let i = at; i < end; i++) {
                const next = out[i - inner] + cells[i];
                if (length > 2 ** 21 && !Number.isSafeInteger(next)) return undefined;
                out[i] = next;
            }
            else if (op === '*') for (let i = at; i < end; i++) {
                const next = out[i - inner] * cells[i];
                if (!Number.isSafeInteger(next)) return undefined;
                out[i] = next;
            }
            else if (op === 'max') for (let i = at; i < end; i++) { const a = out[i - inner], b = cells[i]; out[i] = a > b ? a : b; }
            else for (let i = at; i < end; i++) { const a = out[i - inner], b = cells[i]; out[i] = a < b ? a : b; }
        }
    }
    if (op === '+' || op === '*') for (let i = 0; i < out.length; i++) {
        const x = out[i];
        if (x > INT32_MAX || x < -INT32_MAX - 1) { wide = true; break; }
    }
    if (!wide) return typedArray(out instanceof Int32Array ? out : Int32Array.from(out), [...shape]);
    return typedArray(consumeSafeIntegerBuffer(out as Float64Array), [...shape]);
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
