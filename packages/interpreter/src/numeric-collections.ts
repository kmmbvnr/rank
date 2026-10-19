import { storedScalarCells, typedArray, ownedScalarArray } from './array-storage.js';
import { currentDiagnostics } from './diagnostics.js';
import { checkpoint, interruptsEnabled, privateLoopPolling } from './interrupt.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

const MIN_INT64 = -(1n << 63n), MAX_INT64 = (1n << 63n) - 1n;
type NumericBuffer = BigInt64Array | Float64Array | Uint8Array;

/** Admission inspects no host/lazy cells, contracts or public items getter. */
export function numericCells(value: RankValue): ArrayLike<RankValue> | undefined {
    if (!privateLoopPolling() || !isRankArray(value)) return undefined;
    const cells = storedScalarCells(value);
    if (!cells || value.shape.length !== 1 || value.columnNames) return undefined;
    return cells;
}

/** A private, exactly representable homogeneous numeric copy. NaNs and negative
 * zeros retain generic ordering, which differs from native Float64 sort. */
function orderingCopy(items: ArrayLike<RankValue>): NumericBuffer | undefined {
    const kind = typeof items[0];
    if (!items.length) return undefined;
    if (kind !== 'bigint' && kind !== 'number' && kind !== 'boolean') return undefined;
    const out: NumericBuffer = kind === 'bigint' ? new BigInt64Array(items.length)
        : kind === 'number' ? new Float64Array(items.length) : new Uint8Array(items.length);
    for (let index = 0; index < items.length; index++) {
        if ((index & 4095) === 0) checkpoint('preparing numeric sort', 4096);
        const cell = items[index];
        if (typeof cell !== kind) return undefined;
        if (typeof cell === 'bigint') {
            if (cell < MIN_INT64 || cell > MAX_INT64) return undefined;
            (out as BigInt64Array)[index] = cell;
        } else if (typeof cell === 'number') {
            if (Number.isNaN(cell) || Object.is(cell, -0)) return undefined;
            (out as Float64Array)[index] = cell;
        } else (out as Uint8Array)[index] = Number(cell);
    }
    return out;
}

function resultValues(values: NumericBuffer, order?: Uint32Array): RankArray {
    if (values instanceof Uint8Array) {
        const items = new Array<RankValue>(values.length);
        for (let index = 0; index < items.length; index++) items[index] = values[order ? order[index] : index] !== 0;
        return ownedScalarArray(items, 'boolean');
    }
    if (!order) return typedArray(values);
    const out = values instanceof BigInt64Array ? new BigInt64Array(values.length) : new Float64Array(values.length);
    for (let index = 0; index < values.length; index++) {
        if (out instanceof BigInt64Array) out[index] = (values as BigInt64Array)[order[index]];
        else out[index] = (values as Float64Array)[order[index]];
    }
    return typedArray(out);
}

/** Native sorting is deliberately disabled when cooperative interruption is
 * installed: a single native sort has no checkpoint inside it. */
export function numericSort(value: RankValue, descending: boolean, mode: 'values' | 'indexes' | 'indexed' = 'values'):
    { values?: RankArray; indexes?: RankArray } | undefined {
    if (interruptsEnabled()) return undefined;
    const items = numericCells(value);
    if (!items) return undefined;
    const values = orderingCopy(items);
    if (!values) return undefined;
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.numericSorts++;
    if (mode === 'values') {
        values.sort();
        if (descending) values.reverse();
        return { values: resultValues(values) };
    }
    const order = numericOrder(values, descending);
    const indexes = new BigInt64Array(order.length);
    for (let index = 0; index < order.length; index++) indexes[index] = BigInt(order[index]);
    return { indexes: typedArray(indexes), values: mode === 'indexed' ? resultValues(values, order) : undefined };
}

/** Stable three-pass radix permutation for signed Int32 keys. The wider exact
 * buffers keep the native comparator fallback; keys never truncate to fit. */
function radixOrder(values: NumericBuffer, descending: boolean): Uint32Array | undefined {
    const keys = new Uint32Array(values.length);
    for (let index = 0; index < keys.length; index++) {
        const cell = Number(values[index]);
        if (!Number.isInteger(cell) || cell < -2147483648 || cell > 2147483647) return undefined;
        const key = (cell ^ 0x80000000) >>> 0;
        keys[index] = descending ? ~key : key;
    }
    let order = new Uint32Array(values.length), scratch = new Uint32Array(values.length);
    for (let index = 0; index < order.length; index++) order[index] = index;
    const counts = new Uint32Array(2048);
    for (let shift = 0; shift < 32; shift += 11) {
        counts.fill(0);
        for (let index = 0; index < order.length; index++) counts[(keys[order[index]] >>> shift) & 2047]++;
        let offset = 0;
        for (let bucket = 0; bucket < counts.length; bucket++) {
            const count = counts[bucket]; counts[bucket] = offset; offset += count;
        }
        for (let index = 0; index < order.length; index++) {
            const position = order[index];
            scratch[counts[(keys[position] >>> shift) & 2047]++] = position;
        }
        [order, scratch] = [scratch, order];
    }
    return order;
}

function numericOrder(values: NumericBuffer, descending: boolean): Uint32Array {
    const radix = radixOrder(values, descending);
    if (radix) return radix;
    const order = Uint32Array.from({ length: values.length }, (_, index) => index);
    order.sort((a, b) => {
        const x = values[a], y = values[b];
        return (x < y ? (descending ? 1 : -1) : x > y ? (descending ? -1 : 1) : 0) || a - b;
    });
    return order;
}

/** Axis sorting has already evaluated these cells in ordinary read order. */
export function numericOrderItems(items: readonly RankValue[], descending: boolean): number[] | undefined {
    if (interruptsEnabled() || !privateLoopPolling()) return undefined;
    const values = orderingCopy(items);
    if (!values) return undefined;
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.numericSorts++;
    return Array.from(numericOrder(values, descending));
}

/** Safe integer numbers share exact numeric keys with their BigInt counterpart;
 * larger BigInts stay exact and integer-valued reals use the same key domain. */
export function numericKey(value: RankValue): bigint | number | boolean | undefined {
    if (typeof value === 'bigint') {
        const number = Number(value);
        return Number.isSafeInteger(number) ? number : value;
    }
    if (typeof value === 'number') return Number.isInteger(value) && !Number.isSafeInteger(value) ? BigInt(value) : value;
    return typeof value === 'boolean' ? value : undefined;
}

/** One kernel for materialized unique and fused distinct counts. Keep the first
 * original cell, including -0 and NaN, rather than rebuilding values from keys. */
export function numericDistinct(value: RankValue, countOnly = false): RankArray | bigint | undefined {
    const cells = numericCells(value);
    if (!cells || !cells.length) return undefined;
    const kind = cells.length ? typeof cells[0] : 'bigint';
    if (!['bigint', 'number', 'boolean'].includes(kind)) return undefined;
    const seen = new Set<bigint | number | boolean>();
    const result: RankValue[] = [];

    for (let index = 0; index < cells.length; index++) {
        if ((index & 4095) === 0) checkpoint('counting distinct values', 4096);
        const cell = cells[index];
        if (typeof cell !== kind) return undefined;
        if (typeof cell === 'bigint' && (cell < MIN_INT64 || cell > MAX_INT64)) return undefined;
        const key = numericKey(cell)!;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!countOnly) {
            result.push(cell);
        }
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.numericDistincts++;
    if (countOnly) return BigInt(seen.size);
    if (kind === 'bigint' || kind === 'number') {
        const out = kind === 'bigint' ? new BigInt64Array(result.length) : new Float64Array(result.length);
        for (let index = 0; index < result.length; index++) {
            if ((index & 4095) === 0) checkpoint('building distinct values', 4096);
            if (out instanceof BigInt64Array) out[index] = result[index] as bigint;
            else out[index] = result[index] as number;
        }
        return typedArray(out);
    }
    return ownedScalarArray(result, 'boolean');
}
