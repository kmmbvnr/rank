import { readArrayItem } from './array-storage.js';
import { RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import { arrayRevision } from './array-revision.js';
import { prepareStoredScalarView } from './integer-view.js';
import { isRankArray, type RankValue } from './value.js';

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
