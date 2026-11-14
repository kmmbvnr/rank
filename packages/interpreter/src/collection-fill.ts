import { filledArray, ownedArray, readArrayItem, MAX_HELD_CELLS } from './array-storage.js';
import { chooseValue } from './modules/sequences.js';
import { RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { orderedSource } from './ordered-source.js';
import { setValueKey } from './set.js';
import { textMatchPositions } from './text-search.js';
import { checkedArrayDimension, coordinatesAt, sameShape } from './tensor-index.js';
import { isRankArray, isRankSequence, isRankSequenceMask, isRankDate, isRankLabel, MISSING, type RankArray, type RankValue } from './value.js';

export type CollectionFillOperation = 'mask' | 'unique' | 'findall' | 'indices';

function scalar(value: RankValue): void {
    if (typeof value === 'object' && value !== MISSING && !isRankDate(value) && !isRankLabel(value)) {
        throw new RankError('fill expects a scalar value', 'TypeError');
    }
}

/** Conditional selection keeps source positions and only demands the chosen cells. */
export function maskFill(source: RankValue, mask: RankValue, fill: RankValue): RankValue {
    scalar(fill);
    if (!isRankArray(source) || !isRankArray(mask)) throw new RankError('mask fill expects arrays', 'TypeError');
    if (source.shape.length !== mask.shape.length || source.shape.some((n, axis) => n !== mask.shape[axis])) {
        throw new RankError('mask fill requires the source and mask to have the same shape', 'DimensionMismatch');
    }
    return chooseValue(mask, source, fill);
}

function vector(value: RankValue, operation: string): Iterable<RankValue> {
    if (isRankArray(value)) {
        if (value.shape.length !== 1) throw new RankError(`${operation} shape expects a rank-1 array`, 'TypeError');
        return { *[Symbol.iterator]() {
            for (let index = 0; index < value.shape[0]; index++) {
                checkpoint('reading bounded collection');
                yield readArrayItem(value, index);
            }
        } };
    }
    if (isRankSequence(value)) return { [Symbol.iterator]: () => value.plan.iterate() };
    const source = orderedSource(value, 'unique', operation);
    if (!source) throw new RankError(`${operation} shape expects text or a collection`, 'TypeError');
    return source.values();
}

/** Capacity bounds demand and storage; no discarded result tail is constructed. */
export function collectFilled(operation: CollectionFillOperation, source: RankValue, selector: RankValue | undefined,
    shape: readonly RankValue[], fill: RankValue): RankArray {
    scalar(fill);
    const supplied = shape.length === 1 && isRankArray(shape[0]) ? shape[0] : undefined;
    if (supplied && supplied.shape.length !== 1) throw new RankError('shape expects a vector of dimensions', 'TypeError');
    const values = supplied ? Array.from({ length: supplied.shape[0] }, (_, index) => readArrayItem(supplied, index)) : shape;
    const frame = values.map(value => {
        if (typeof value !== 'bigint') throw new RankError('shape dimensions must be nonnegative integers', 'TypeError');
        return checkedArrayDimension(value);
    });
    const count = frame.reduce((product, dimension) => product * BigInt(dimension), 1n);
    if (count > BigInt(MAX_HELD_CELLS)) throw new RankError('shape result is too large', 'DomainError');
    const capacity = Number(count);
    let cell: number[] = [];
    let results: Iterable<RankValue>;
    if (operation === 'indices') {
        if (!isRankArray(source) || !source.shape.length) throw new RankError('indices expects an array of rank at least 1', 'TypeError');
        const mask = source;
        const count = mask.shape.reduce((a, b) => a * b, 1);
        if (mask.shape.length > 1) cell = [mask.shape.length];
        results = { *[Symbol.iterator]() {
            for (let index = 0; index < count; index++) {
                checkpoint('finding bounded indices');
                const selected = readArrayItem(mask, index);
                if (typeof selected !== 'boolean') throw new RankError('indices expects boolean values', 'TypeError');
                if (selected) yield cell.length ? ownedArray(coordinatesAt(mask.shape, index).map(BigInt)) : BigInt(index);
            }
        } };
    } else if (operation === 'findall') {
        if (typeof source === 'string' && typeof selector === 'string') results = textMatchPositions(source, selector);
        else {
            if (typeof source !== 'string' && (!isRankArray(source) || source.shape.length !== 1)) {
                throw new RankError('findall expects text or a rank-1 array', 'TypeError');
            }
            const values = vector(source, operation), key = setValueKey(selector!);
            results = { *[Symbol.iterator]() {
                let index = 0n;
                for (const value of values) {
                    if (setValueKey(value) === key) yield index;
                    index++;
                }
            } };
        }
    } else if (operation === 'unique') {
        const values = vector(source, operation);
        const keyOf = isRankArray(source) || isRankSequence(source) ? setValueKey
            : orderedSource(source, 'unique', operation)?.key ?? setValueKey;
        results = { *[Symbol.iterator]() {
            const seen = new Set<string>();
            for (const value of values) {
                checkpoint('finding bounded unique values');
                const key = keyOf(value);
                if (seen.has(key)) continue;
                seen.add(key);
                yield value;
            }
        } };
    } else {
        if ((!isRankArray(source) && !isRankSequence(source))
            || (!selector || !isRankArray(selector) && !isRankSequence(selector))) {
            throw new RankError('mask shape expects arrays or sequences', 'TypeError');
        }
        const input = source, mask = selector;
        const bothArrays = isRankArray(input) && isRankArray(mask);
        if (bothArrays ? !sameShape(input.shape, mask.shape)
            : isRankArray(input) && input.shape.length !== 1 || isRankArray(mask) && mask.shape.length !== 1) {
            throw new RankError('mask shape requires matching array shapes; stream masks are rank 1', 'DimensionMismatch');
        }
        const inputSize = isRankArray(input) ? input.shape.reduce((count, n) => count * BigInt(n), 1n)
            : input.plan.size.kind === 'exact' ? input.plan.size.value : undefined;
        const maskSize = isRankArray(mask) ? mask.shape.reduce((count, n) => count * BigInt(n), 1n)
            : mask.plan.size.kind === 'exact' ? mask.plan.size.value : undefined;
        if (isRankSequence(input) && input.plan.size.kind === 'infinite' && maskSize !== undefined
            || isRankSequence(mask) && mask.plan.size.kind === 'infinite' && inputSize !== undefined) {
            throw new RankError('mask shape requires matching input lengths', 'DimensionMismatch');
        }
        if (inputSize !== undefined && maskSize !== undefined && inputSize !== maskSize) {
            throw new RankError('mask shape requires matching input lengths', 'DimensionMismatch');
        }
        results = { *[Symbol.iterator]() {
            if (isRankSequenceMask(mask) && mask.source === input) {
                for (const value of vector(input, 'mask')) {
                    checkpoint('collecting bounded mask');
                    if (mask.predicate.test(value)) yield value;
                }
                return;
            }
            if (isRankArray(input) && isRankArray(mask)) {
                const length = Number(inputSize);
                for (let index = 0; index < length; index++) {
                    checkpoint('collecting bounded mask');
                    const flag = readArrayItem(mask, index);
                    if (typeof flag !== 'boolean') throw new RankError('mask expects boolean values', 'TypeError');
                    if (flag) yield readArrayItem(input, index);
                }
                return;
            }
            const flags = vector(mask, 'mask')[Symbol.iterator]();
            try {
                for (const value of vector(input, 'mask')) {
                    checkpoint('collecting bounded mask');
                    const flag = flags.next();
                    if (flag.done) throw new RankError('mask is shorter than its source', 'DimensionMismatch');
                    if (typeof flag.value !== 'boolean') throw new RankError('mask expects boolean values', 'TypeError');
                    if (flag.value) yield value;
                }
                if (!flags.next().done) throw new RankError('mask is longer than its source', 'DimensionMismatch');
            } finally { flags.return?.(); }
        } };
    }
    const width = cell.reduce((a, b) => a * b, 1);
    if (capacity * width > MAX_HELD_CELLS) throw new RankError('shape result is too large', 'DomainError');
    if (capacity === 0) return filledArray(fill, [...frame, ...cell]);
    const items: RankValue[] = [];
    if (capacity) for (const value of results) {
        if (cell.length) {
            if (!isRankArray(value)) throw new RankError('expected an index row');
            for (let index = 0; index < width; index++) items.push(readArrayItem(value, index));
        } else { scalar(value); items.push(value); }
        if (items.length === capacity * width) break;
    }
    while (items.length < capacity * width) { checkpoint('filling bounded collection'); items.push(fill); }
    return ownedArray(items, [...frame, ...cell]);
}
