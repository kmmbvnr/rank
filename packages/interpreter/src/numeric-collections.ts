import { integerMaskSelection } from './array-mask-selection.js';
import { prepareIntegerView, prepareStoredScalarView } from './integer-view.js';
import { denseScalarItems, typedArray, ownedScalarArray, isSharedArray, sortStoredIntegerArray, integer32Cells, IntegerCells } from './array-storage.js';
import { constructingTensorPlan, visitIntegerTensorMap } from './tensor-map.js';
import { currentDiagnostics } from './diagnostics.js';
import { integerConcatCells } from './concat-array.js';
import { checkpoint, interruptsEnabled, privateLoopPolling } from './interrupt.js';
import { isRankArray, isRankSequence, type RankArray, type RankValue } from './value.js';

const MIN_INT64 = -(1n << 63n), MAX_INT64 = (1n << 63n) - 1n;
type NumericBuffer = BigInt64Array | Float64Array | Uint8Array;

/** Only a proved self-rebinding sort may consume a uniquely held buffer. */
export function numericSortInPlace(value: RankValue, descending = false): RankArray | undefined {
    if (!isRankArray(value) || isSharedArray(value)) return undefined;
    const result = sortStoredIntegerArray(value, descending);
    if (result) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) { diagnostics.numericSorts++; diagnostics.numericInPlaceSorts++; }
    }
    return result;
}

/** Admission inspects no host/lazy cells, contracts or public items getter. */
export function numericCells(value: RankValue): ArrayLike<RankValue> | undefined {
    if (!privateLoopPolling() || !isRankArray(value)) return undefined;
    const cells = denseScalarItems(value);
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

/** Stable three-pass radix permutation for signed Int32 keys. Wider integers
 * continue through the Int64 path; keys never truncate to fit this one. */
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
    const radix = radixOrder(values, descending) ?? wideIntegerOrder(values, descending);
    if (radix) return radix;
    const order = Uint32Array.from({ length: values.length }, (_, index) => index);
    order.sort((a, b) => {
        const x = values[a], y = values[b];
        return (x < y ? (descending ? 1 : -1) : x > y ? (descending ? -1 : 1) : 0) || a - b;
    });
    return order;
}

const lowWord = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1;

/** Stable signed Int64 permutation, including values beyond Number precision.
 * Read the two words directly; conversion through Number would merge nearby
 * large integers. Each word takes three stable 11-bit counting passes. */
function wideIntegerOrder(values: NumericBuffer, descending: boolean): Uint32Array | undefined {
    if (!(values instanceof BigInt64Array)) return undefined;
    const words = new Uint32Array(values.buffer, values.byteOffset, values.length * 2);
    let order = new Uint32Array(values.length), scratch = new Uint32Array(values.length);
    for (let index = 0; index < order.length; index++) order[index] = index;
    const counts = new Uint32Array(2048);
    for (const word of [lowWord, 1 - lowWord]) {
        const sign = word === lowWord ? 0 : 0x80000000;
        const flip = descending ? ~sign : sign;
        for (let shift = 0; shift < 32; shift += 11) {
            counts.fill(0);
            for (let index = 0; index < order.length; index++) {
                counts[((words[2 * order[index] + word] ^ flip) >>> shift) & 2047]++;
            }
            let offset = 0;
            for (let bucket = 0; bucket < counts.length; bucket++) {
                const count = counts[bucket]; counts[bucket] = offset; offset += count;
            }
            for (let index = 0; index < order.length; index++) {
                const position = order[index];
                scratch[counts[((words[2 * position + word] ^ flip) >>> shift) & 2047]++] = position;
            }
            [order, scratch] = [scratch, order];
        }
    }
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

/** Borrow only checked native integer graphs. Each demand owns its private
 * consumer state; a declined kernel never publishes a partial result. */
function integerTensor(value: RankValue): value is RankArray {
    return privateLoopPolling() && isRankArray(value) && constructingTensorPlan(value)
        && value.shape.length === 1 && !value.columnNames;
}

function tensorDistinct(value: RankValue, countOnly: boolean): RankArray | bigint | undefined {
    if (!integerTensor(value)) return undefined;
    const seen = new Set<bigint | number | boolean>();
    const result: RankValue[] = [];
    if (!visitIntegerTensorMap(value, cell => {
        const key = numericKey(cell)!;
        if (seen.has(key)) return;
        seen.add(key);
        if (!countOnly) result.push(cell);
    })) return undefined;
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.numericDistincts++; diagnostics.compiledDistincts++; }
    // ownedScalarArray packs only representable cells; wider integers stay exact.
    return countOnly ? BigInt(seen.size) : ownedScalarArray(result, 'integer');
}

function tensorOrderingCopy(value: RankValue): BigInt64Array | undefined {
    if (!integerTensor(value)) return undefined;
    let buffer: BigInt64Array | undefined, index = 0, wide = false;
    if (!visitIntegerTensorMap(value, cell => {
        buffer ??= new BigInt64Array(value.shape[0]);
        if (cell < MIN_INT64 || cell > MAX_INT64) wide = true;
        else buffer[index] = cell;
        index++;
    }) || wide) return undefined;
    return buffer ?? new BigInt64Array(0);
}

/** Fuse distinct + ascending sort only for trusted homogeneous numeric storage.
 * Native sort cannot poll; interactive execution keeps the ordinary path.
 * NaN and signed zero retain unique's first-occurrence semantics via fallback. */
export function numericUniqueSort(value: RankValue): RankArray | undefined {
    if (interruptsEnabled()) return undefined;
    const cells = numericCells(value);
    const concat = !cells && privateLoopPolling() && isRankArray(value) ? integerConcatCells(value) : undefined;
    const buffer = cells ? orderingCopy(cells) : concat ? new BigInt64Array(concat.length) : tensorOrderingCopy(value);
    if (!buffer) return undefined;
    const length = buffer.length;
    if (!length) return resultValues(buffer);
    if (concat) {
        for (let index = 0; index < length; index++) {
            const cell = concat.read(index);
            if (cell < MIN_INT64 || cell > MAX_INT64) return undefined;
            (buffer as BigInt64Array)[index] = cell;
        }
    }
    buffer.sort();
    let size = 1;
    for (let index = 1; index < length; index++) {
        if (buffer[index] === buffer[size - 1]) continue;
        // The buffer's element type is unchanged throughout this pass.
        if (buffer instanceof BigInt64Array) buffer[size++] = buffer[index];
        else buffer[size++] = buffer[index];
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.numericUniqueSorts++;
    return resultValues(buffer.slice(0, size));
}

/** One kernel for materialized unique and fused distinct counts. Keep the first
 * original cell, including -0 and NaN, rather than rebuilding values from keys. */
export function numericDistinct(value: RankValue, countOnly = false): RankArray | bigint | undefined {
    const cells = numericCells(value);
    const concat = !cells && privateLoopPolling() && isRankArray(value) ? integerConcatCells(value) : undefined;
    const length = cells?.length ?? concat?.length;
    if (!length) return tensorDistinct(value, countOnly);
    const kind = cells ? typeof cells[0] : 'bigint';
    if (!['bigint', 'number', 'boolean'].includes(kind)) return undefined;
    // Trusted Int32 cells have exact Number keys. Avoid boxing every input
    // through the integer items Proxy; the result still exposes Rank integers.
    const compact = cells && isRankArray(value) ? integer32Cells(value) : undefined;
    if (compact) {
        const seen = new Set<number>();
        const result: number[] = [];
        for (let index = 0; index < compact.length; index++) {
            if ((index & 4095) === 0) checkpoint('counting distinct values', 4096);
            const cell = compact[index];
            if (seen.has(cell)) continue;
            seen.add(cell);
            if (!countOnly) result.push(cell);
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.numericDistincts++;
        if (countOnly) return BigInt(seen.size);
        const out = new Int32Array(result.length);
        for (let index = 0; index < result.length; index++) {
            if ((index & 4095) === 0) checkpoint('building distinct values', 4096);
            out[index] = result[index];
        }
        return typedArray(out);
    }
    const seen = new Set<bigint | number | boolean>();
    const result: RankValue[] = [];

    for (let index = 0; index < length; index++) {
        if ((index & 4095) === 0) checkpoint('counting distinct values', 4096);
        const cell = cells ? cells[index] : concat!.read(index);
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
    if (kind === 'bigint') {
        const out = new IntegerCells(result.length);
        for (let index = 0; index < result.length; index++) {
            if ((index & 4095) === 0) checkpoint('building distinct values', 4096);
            out.set(index, result[index] as bigint);
        }
        return out.array([result.length]);
    }
    if (kind === 'number') {
        const out = new Float64Array(result.length);
        for (let index = 0; index < result.length; index++) {
            if ((index & 4095) === 0) checkpoint('building distinct values', 4096);
            out[index] = result[index] as number;
        }
        return typedArray(out);
    }
    return ownedScalarArray(result, 'boolean');
}

/** Exact integer distinct sum, retaining ordinary floating-point fallback. */
export function numericUniqueSum(value: RankValue): bigint | undefined {
    const result = integerDistinctConsumer(value, 'sum');
    return typeof result === 'bigint' ? result : undefined;
}

/** Shared consumers compose native slices, masks and integer arithmetic graphs. */
export function integerDistinctConsumer(value: RankValue, terminal: 'array' | 'sum' | 'len'): RankValue | undefined {
    if (!privateLoopPolling()) return undefined;
    const view = isRankArray(value) && value.shape.length === 1 && !value.columnNames
        ? prepareIntegerView(value, true) : undefined;
    const selected = isRankSequence(value) ? integerMaskSelection(value) : undefined;
    if (!view && !selected && !integerTensor(value)) return undefined;
    const stored = view ? prepareStoredScalarView(value, true) : undefined;
    const compact = stored?.linear && (!stored.validate || stored.validateUniform) ? stored.compact : undefined;
    if (compact && terminal === 'sum') {
        const { offset, stride } = stored!.linear!;
        const length = view!.shape[0];
        if (length) stored!.validateUniform?.(BigInt(compact[offset]));
        const seen = new Set<number>();
        let partial = 0, sum = 0n;
        for (let i = 0; i < length; i++) {
            if ((i & 4095) === 0) checkpoint('summing distinct integers', 4096);
            const cell = compact[offset + i * stride];
            if (seen.has(cell)) continue;
            seen.add(cell);
            const next = partial + cell;
            if (Number.isSafeInteger(next)) partial = next;
            else { sum += BigInt(partial); partial = cell; }
        }
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.numericUniqueSums++;
        return sum + BigInt(partial);
    }
    const seen = new Set<bigint | number | boolean>();
    const items: bigint[] = [];
    let sum = 0n;
    const accept = (cell: bigint) => {
        const key = numericKey(cell)!;
        if (seen.has(key)) return;
        seen.add(key);
        if (terminal === 'array') items.push(cell);
        else if (terminal === 'sum') sum += cell;
    };

    if (compact) {
        let partial = 0;
        for (let i = 0; i < view!.shape[0]; i++) {
            if ((i & 4095) === 0) checkpoint('consuming distinct integers', 4096);
            const key = compact[stored!.linear!.offset + i * stored!.linear!.stride];
            if (i === 0) stored!.validateUniform?.(BigInt(key));
            if (seen.has(key)) continue;
            seen.add(key);
            if (terminal === 'array') items.push(BigInt(key));
            else if (terminal === 'sum') {
                const next = partial + key;
                if (Number.isSafeInteger(next)) partial = next;
                else { sum += BigInt(partial); partial = key; }
            }
        }
        sum += BigInt(partial);
    } else if (view || selected) {
        const read = selected?.read ?? view!.read;
        const length = selected?.length ?? view!.shape[0];
        for (let i = 0; i < length; i++) {
            if ((i & 4095) === 0) checkpoint('consuming distinct integers', 4096);
            accept(read(i));
        }
    } else if (!visitIntegerTensorMap(value as RankArray, accept)) return undefined;
    const diagnostics = currentDiagnostics();
    if (diagnostics && terminal === 'sum') diagnostics.numericUniqueSums++;
    return terminal === 'array' ? ownedScalarArray(items, 'integer') : terminal === 'sum' ? sum : BigInt(seen.size);
}

/** Bounded max heap: retain only the K smallest exact integers. */
export function numericSmallest(value: RankValue, count: RankValue, distinct: boolean): RankValue | undefined {
    const cells = numericCells(value);
    const view = !cells && privateLoopPolling() && isRankArray(value) && value.shape.length === 1 && !value.columnNames
        ? prepareIntegerView(value, true) : undefined;
    const concat = !cells && !view && privateLoopPolling() && isRankArray(value) ? integerConcatCells(value) : undefined;
    if ((!cells && !view && !concat) || typeof count !== 'bigint' || count < 0n || count > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    const compact = isRankArray(value) ? integer32Cells(value) : undefined;
    if (cells && !compact) for (let i = 0; i < cells.length; i++) if (typeof cells[i] !== 'bigint') return undefined;
    const length = cells?.length ?? view?.shape[0] ?? concat!.length;
    const limit = Math.min(Number(count), length);
    const heap: (bigint | number)[] = [], seen = distinct ? new Set<bigint | number>() : undefined;
    for (let i = 0; i < length; i++) {
        if ((i & 4095) === 0) checkpoint('selecting smallest integers', 4096);
        const cell = compact ? compact[i] : cells ? cells[i] as bigint : view ? view.read(i) : concat!.read(i);
        if (!limit || seen?.has(cell)) continue;
        if (heap.length < limit) {
            let at = heap.length;
            heap.push(cell);
            while (at > 0) {
                const parent = (at - 1) >> 1;
                if (heap[parent] >= cell) break;
                heap[at] = heap[parent]; at = parent;
            }
            heap[at] = cell;
        } else {
            if (cell >= heap[0]) continue;
            seen?.delete(heap[0]);
            let at = 0;
            while (at * 2 + 1 < heap.length) {
                let child = at * 2 + 1;
                if (child + 1 < heap.length && heap[child + 1] > heap[child]) child++;
                if (heap[child] <= cell) break;
                heap[at] = heap[child]; at = child;
            }
            heap[at] = cell;
        }
        seen?.add(cell);
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.numericSmallestSelections++;
    // Poll inside comparisons; unlike native typed sorting this also works interactively.
    heap.sort((a, b) => { checkpoint('ordering smallest integers'); return a < b ? -1 : a > b ? 1 : 0; });
    return ownedScalarArray(heap.map(BigInt), 'integer');
}
