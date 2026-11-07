import { readArrayItem } from './array-storage.js';
import { currentDiagnostics } from '../diagnostics.js';
import { RankError } from '../errors.js';
import { checkpoint, privateLoopPolling, demandBudgetEnabled, inspectionEnabled } from '../interrupt.js';
import { arrayRevision } from './array-revision.js';
import { prepareStoredScalarView } from './integer-view.js';
import { typedArray } from './owned-array.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

type StoredView = ReturnType<typeof prepareStoredScalarView>;

// Vector targets search one source many times: prepare its view once.
const prepared = new WeakMap<object, { revision: number; view: StoredView; searchWork?: number; withoutNaN?: boolean }>();

function storedView(source: RankValue & object): StoredView {
    const revision = isRankArray(source) ? arrayRevision(source) : undefined;
    const known = prepared.get(source);
    if (known && known.revision === revision) return known.view;
    const view = prepareStoredScalarView(source);
    if (revision !== undefined) prepared.set(source, { revision, view });
    return view;
}

/** The caller supplies an ascending numeric vector. Inspect only the binary
 * search path: validating sortedness on each call would make queries linear. */
export function sortedIndex(source: RankValue, target: RankValue, upper: boolean): bigint {
    const name = upper ? 'upperindex' : 'lowerindex';
    if (!isRankArray(source) || source.shape.length !== 1) {
        throw new RankError(`${name} expects a sorted numeric vector`);
    }
    if (typeof target !== 'bigint' && typeof target !== 'number' || Number.isNaN(target))
        throw new RankError(`${name} expects a numeric target other than NaN`);
    let low = 0, high = source.shape[0];
    // Stored Int64 cells compare in place, skipping the per-probe reader.
    const view = privateLoopPolling() && !demandBudgetEnabled() && !inspectionEnabled() ? storedView(source) : undefined;
    const narrow = view?.compact !== undefined && view.linear && !view.validate ? view.compact : undefined;
    if (narrow) {
        checkpoint('searching sorted numbers', Math.ceil(Math.log2(high + 1)));
        if (target > 2147483647n) return BigInt(high);
        if (target < -2147483648n) return 0n;
        const wanted = Number(target), { offset, stride } = view!.linear!;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const value = narrow[offset + middle * stride];
            if (upper ? value <= wanted : value < wanted) low = middle + 1;
            else high = middle;
        }
        return BigInt(low);
    }
    const cells = view?.items instanceof BigInt64Array && view.linear && !view.validate ? view.items : undefined;
    if (cells) {
        checkpoint('searching sorted numbers', Math.ceil(Math.log2(high + 1)));
        const { offset, stride } = view!.linear!;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            const value = cells[offset + middle * stride];
            if (upper ? value <= target : value < target) low = middle + 1;
            else high = middle;
        }
        return BigInt(low);
    }
    if (view?.items instanceof Float64Array && view.linear && !view.validate) {
        checkpoint('searching sorted numbers', Math.ceil(Math.log2(high + 1)));
        const { offset, stride } = view.linear, cells = view.items;
        while (low < high) {
            const middle = Math.floor((low + high) / 2), value = cells[offset + middle * stride];
            if (Number.isNaN(value)) throw new RankError(`${name} expects a sorted numeric vector without NaN`);
            if (upper ? value <= target : value < target) low = middle + 1;
            else high = middle;
        }
        return BigInt(low);
    }
    while (low < high) {
        checkpoint('searching sorted numbers');
        const middle = Math.floor((low + high) / 2);
        const value = readArrayItem(source, middle);
        if (typeof value !== 'bigint' && typeof value !== 'number' || Number.isNaN(value))
            throw new RankError(`${name} expects a sorted numeric vector without NaN`);
        if (upper ? value <= target : value < target) low = middle + 1;
        else high = middle;
    }
    return BigInt(low);
}

/** Search every stored numeric target in one pass over a stored numeric
 * source, or decline for any other storage. The previous answer bounds the
 * next one, and near-ordered targets gallop from it, so a sorted batch avoids
 * full searches. */
export function sortedIndexBatch(source: RankValue, targets: RankValue, upper: boolean): RankArray | undefined {
    // Batch results use Int32 cells; wider indices keep the scalar BigInt path.
    if (!privateLoopPolling() || demandBudgetEnabled() || inspectionEnabled()
        || !isRankArray(source) || source.shape.length !== 1 || !isRankArray(targets)) return undefined;
    const sview = storedView(source), tview = storedView(targets);
    if (!sview?.linear || sview.validate || !tview?.linear || tview.validate) return undefined;
    const size = source.shape[0];
    if (size > 2147483647) return undefined;
    const cells = sview.compact ?? (sview.items instanceof BigInt64Array || sview.items instanceof Float64Array ? sview.items : undefined);
    const wide = tview.items instanceof BigInt64Array ? tview.items : undefined;
    const narrow = tview.compact;
    const real = tview.items instanceof Float64Array ? tview.items : undefined;
    if (!cells || !wide && !narrow && !real || !(cells.buffer instanceof ArrayBuffer)
        || !((narrow ?? wide ?? real)!.buffer instanceof ArrayBuffer)) return undefined;
    const { offset, stride } = tview.linear;
    const count = targets.shape.reduce((n, d) => n * d, 1);
    const found = new Int32Array(count);
    if (cells instanceof Float64Array || real) {
        // Prove NaN-free ready inputs only when the scan can amortize over
        // the batch. Tiny batches retain scalar logarithmic searches.
        const record = prepared.get(source);
        const known = record?.view === sview && record.withoutNaN;
        const sourceProof = cells instanceof Float64Array && !known ? size : 0;
        const targetProof = real ? count : 0;
        const work = count * Math.ceil(Math.log2(size + 1));
        // Repeated small batches can amortize one source proof together.
        // Both the credit and proof expire with the owned source revision.
        if (targetProof > work) return undefined;
        const credit = record ? Math.min(size, (record.searchWork ?? 0) + work - targetProof) : work - targetProof;
        if (record) record.searchWork = credit;
        if (sourceProof > credit) return undefined;
        if (cells instanceof Float64Array && !known) {
            if (!withoutNaN(cells, sview.linear, size)) return undefined;
            if (record) {
                if (arrayRevision(source) !== record.revision) return undefined;
                record.withoutNaN = true;
            }
        }
        if (real && !withoutNaN(real, tview.linear, count)) return undefined;
        search<number | bigint>(cells, sview.linear, size, found, upper, at => real ? real[offset + at * stride]
            : narrow ? narrow[offset + at * stride] : wide![offset + at * stride]);
    } else if (cells instanceof Int32Array) {
        search(cells, sview.linear, size, found, upper, at => {
            if (narrow) return narrow[offset + at * stride];
            const big = wide![offset + at * stride];
            return big > 2147483647n ? 2147483648 : big < -2147483648n ? -2147483649 : Number(big);
        });
    } else {
        search(cells, sview.linear, size, found, upper, at => narrow ? BigInt(narrow[offset + at * stride]) : wide![offset + at * stride]);
    }
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.sortedIndexBatches++; diagnostics.sortedIndexBatchQueries += count; }
    return typedArray(found, targets.shape);
}

function withoutNaN(cells: Float64Array, linear: { offset: number; stride: number }, count: number): boolean {
    for (let index = 0; index < count; index++) {
        if ((index & 4095) === 0) checkpoint('checking sorted numbers', Math.min(4096, count - index));
        if (Number.isNaN(cells[linear.offset + index * linear.stride])) return false;
    }
    return true;
}

function search<T extends number | bigint>(cells: ArrayLike<T>, linear: { offset: number; stride: number }, size: number,
    found: Int32Array, upper: boolean, target: (at: number) => T): void {
    const base = linear.offset, step = linear.stride, count = found.length;
    // Both operands are numeric primitives: == retains exact mixed
    // integer/real ties without converting an arbitrary-precision target.
    const below = (value: T, wanted: T) => value < wanted || upper && value == wanted;
    let previous: T | undefined, answer = 0;
    for (let at = 0; at < count; at++) {
        if ((at & 4095) === 0) checkpoint('searching sorted numbers', Math.ceil(Math.log2(size + 1)) * Math.min(4096, count - at));
        const wanted = target(at);
        let low = 0, high = size;
        if (previous !== undefined) {
            if (wanted >= previous) {
                // Gallop right from the last answer.
                low = answer;
                let reach = 1;
                while (low + reach < size) {
                    if (below(cells[base + (low + reach) * step], wanted)) { low += reach; reach *= 2; } else { high = low + reach; break; }
                }
            } else {
                high = answer;
                for (let reach = 1; reach <= high; reach *= 2) {
                    const probe = high - reach;
                    if (below(cells[base + probe * step], wanted)) { low = probe + 1; break; }
                    high = probe;
                }
            }
        }
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (below(cells[base + middle * step], wanted)) low = middle + 1;
            else high = middle;
        }
        answer = low;
        previous = wanted;
        found[at] = low;
    }
}
