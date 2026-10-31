import { readArrayItem } from './array-storage.js';
import { RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import { arrayRevision } from './array-revision.js';
import { prepareStoredScalarView } from './integer-view.js';
import { typedArray } from './owned-array.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

type StoredView = ReturnType<typeof prepareStoredScalarView>;

// Vector targets search one source many times: prepare its view once.
const prepared = new WeakMap<object, { revision: number; view: StoredView }>();

function storedView(source: RankValue & object): StoredView {
    const revision = isRankArray(source) ? arrayRevision(source) : undefined;
    const known = prepared.get(source);
    if (known && known.revision === revision) return known.view;
    const view = prepareStoredScalarView(source);
    if (revision !== undefined) prepared.set(source, { revision, view });
    return view;
}

/** The caller supplies an ascending integer vector. Inspect only the binary
 * search path: validating sortedness on each call would make queries linear. */
export function sortedIndex(source: RankValue, target: RankValue, upper: boolean): bigint {
    const name = upper ? 'upperindex' : 'lowerindex';
    if (!isRankArray(source) || source.shape.length !== 1) {
        throw new RankError(`${name} expects a sorted integer vector`);
    }
    if (typeof target !== 'bigint') throw new RankError(`${name} expects an integer target`);
    let low = 0, high = source.shape[0];
    // Stored Int64 cells compare in place, skipping the per-probe reader.
    const view = storedView(source);
    const narrow = view?.compact !== undefined && view.linear && !view.validate ? view.compact : undefined;
    if (narrow) {
        checkpoint('searching sorted integers', Math.ceil(Math.log2(high + 1)));
        if (target > 2147483647n) return BigInt(high);
        if (target < -2147483648n) return 0n;
        const wanted = Number(target), { offset, stride } = view!.linear!;
        while (low < high) {
            const middle = (low + high) >>> 1;
            const value = narrow[offset + middle * stride];
            if (value < wanted || upper && value === wanted) low = middle + 1;
            else high = middle;
        }
        return BigInt(low);
    }
    const cells = view?.items instanceof BigInt64Array && view.linear && !view.validate ? view.items : undefined;
    if (cells) {
        checkpoint('searching sorted integers', Math.ceil(Math.log2(high + 1)));
        const { offset, stride } = view!.linear!;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            const value = cells[offset + middle * stride];
            if (value < target || upper && value === target) low = middle + 1;
            else high = middle;
        }
        return BigInt(low);
    }
    while (low < high) {
        checkpoint('searching sorted integers');
        const middle = Math.floor((low + high) / 2);
        const value = readArrayItem(source, middle);
        if (typeof value !== 'bigint') throw new RankError(`${name} expects a sorted integer vector`);
        if (value < target || upper && value === target) low = middle + 1;
        else high = middle;
    }
    return BigInt(low);
}

/** Search every stored integer target in one pass over a stored integer
 * source, or decline for any other storage. The previous answer bounds the
 * next one, and near-ordered targets gallop from it, so a sorted batch avoids
 * full searches. */
export function sortedIndexBatch(source: RankValue, targets: RankValue, upper: boolean): RankArray | undefined {
    if (!isRankArray(source) || source.shape.length !== 1 || !isRankArray(targets)) return undefined;
    const sview = storedView(source), tview = storedView(targets);
    if (!sview?.linear || sview.validate || !tview?.linear || tview.validate) return undefined;
    const cells = sview.compact ?? (sview.items instanceof BigInt64Array ? sview.items : undefined);
    const wide = tview.items instanceof BigInt64Array ? tview.items : undefined;
    const narrow = tview.compact;
    if (!cells || !wide && !narrow) return undefined;
    const { offset, stride } = tview.linear;
    const count = targets.shape.reduce((n, d) => n * d, 1);
    const found = new Int32Array(count);
    if (cells instanceof Int32Array) {
        search(cells, sview.linear, source.shape[0], found, upper, at => {
            if (narrow) return narrow[offset + at * stride];
            const big = wide![offset + at * stride];
            return big > 2147483647n ? 2147483648 : big < -2147483648n ? -2147483649 : Number(big);
        });
    } else {
        search(cells, sview.linear, source.shape[0], found, upper, at => narrow ? BigInt(narrow[offset + at * stride]) : wide![offset + at * stride]);
    }
    return typedArray(found, targets.shape);
}

function search<T extends number | bigint>(cells: ArrayLike<T>, linear: { offset: number; stride: number }, size: number,
    found: Int32Array, upper: boolean, target: (at: number) => T): void {
    const base = linear.offset, step = linear.stride, count = found.length;
    const below = (value: T, wanted: T) => value < wanted || upper && value === wanted;
    let previous: T | undefined, answer = 0;
    for (let at = 0; at < count; at++) {
        if ((at & 4095) === 0) checkpoint('searching sorted integers', Math.ceil(Math.log2(size + 1)) * Math.min(4096, count - at));
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
