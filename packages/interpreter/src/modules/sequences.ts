import { RankError } from '../errors.js';
import { RankDeque, RankHeap } from '../containers.js';
import { compareOrderedValues, orderedKind, type OrderedKind } from '../ordered.js';
import { sequence, windowValue } from '../sequence.js';
import { setValueKey } from '../set.js';
import {
    isRankArray,
    isRankCounter,
    isRankGraph,
    isRankDsu,
    isRankMultiset,
    isRankObject,
    isRankQueue,
    isRankSequence,
    isRankSet,
    type RankArray,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
} from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

interface Boundary {
    readonly limit: bigint;
    readonly inclusive: boolean;
}

export const sequencesModule: RuntimeModule = {
    fibonacci: () => sequence(fibonacciPlan()),
    primes: () => sequence(primePlan()),
    len: () => native('len', 1, arguments_ => lengthOf(arguments_[0])),
    shape: () => native('shape', 1, arguments_ => shapeOf(arguments_[0])),
    copy: () => native('copy', 1, arguments_ => copyArray(arguments_[0])),
    sort: () => native('sort', 1, arguments_ => sortValue(arguments_[0]), 1),
    argsort: () => native(
        'argsort',
        1,
        arguments_ => argsortValue(arguments_[0]),
        1,
        undefined,
        shape => shape,
    ),
    transpose: () => native('transpose', 1, arguments_ => transposeValue(arguments_[0])),
    unique: () => native('unique', 1, arguments_ => uniqueValue(arguments_[0]), 1),
    window: () => native('window', 2, arguments_ => windowValue(arguments_[0], arguments_[1])),
    reshape: () => native('reshape', 2, arguments_ => reshape(arguments_[0], arguments_[1])),
    all: () => native('all', 1, arguments_ => booleanReduction(arguments_[0], 'all')),
    any: () => native('any', 1, arguments_ => booleanReduction(arguments_[0], 'any')),
    count: () => native('count', 1, arguments_ => countTrue(arguments_[0])),
};

function booleanReduction(value: RankValue, operation: 'all' | 'any'): boolean {
    const expected = operation === 'all';
    for (const item of collectionValues(value, operation)) {
        if (typeof item !== 'boolean') {
            throw new RankError(`${operation} expects boolean values`, 'TypeError');
        }
        if (item !== expected) return !expected;
    }
    return expected;
}

function countTrue(value: RankValue): bigint {
    let count = 0n;
    for (const item of collectionValues(value, 'count')) {
        if (typeof item !== 'boolean') {
            throw new RankError('count expects boolean values', 'TypeError');
        }
        if (item) count += 1n;
    }
    return count;
}

function* collectionValues(value: RankValue, operation: string): IterableIterator<RankValue> {
    if (value instanceof RankDeque || value instanceof RankHeap) { yield* value.values(); return; }
    if (isRankArray(value)) {
        const size = value.shape.reduce((product, dimension) => product * dimension, 1);
        for (let index = 0; index < size; index += 1) {
            yield value.itemAt?.(index) ?? value.items[index];
        }
        return;
    }
    if (isRankQueue(value)) {
        yield* value.items;
        return;
    }
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError(`${operation} requires a bounded sequence`);
        }
        yield* value.plan.iterate();
        return;
    }
    yield value;
}

function copyArray(value: RankValue): RankArray {
    if (!isRankArray(value)) throw new RankError('copy expects an array');
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    const items = Array.from(
        { length: size },
        (_, index) => value.itemAt?.(index) ?? value.items[index],
    );
    return { kind: 'array', shape: [...value.shape], items };
}

export function transposeValue(value: RankValue, axes?: readonly number[]): RankValue {
    if (!isRankArray(value)) throw new RankError('transpose expects an array');
    const permutation = axes
        ? [...axes]
        : value.shape.map((_, axis) => axis).reverse();
    if (permutation.length !== value.shape.length) {
        throw new RankError(
            `transpose expects ${value.shape.length} axes, got ${permutation.length}`,
        );
    }
    for (const axis of permutation) {
        if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
    }
    if (new Set(permutation).size !== permutation.length) {
        throw new RankError('transpose axes must be unique');
    }

    const shape = permutation.map(axis => value.shape[axis]);
    let materialized: RankValue[] | undefined;
    const itemAt = (index: number): RankValue => {
        const output = coordinatesAt(shape, index);
        const sourceRank = value.shape.length;
        let source: number[];
        if (sourceRank === 2 && output.length === 2) {
            // These coordinates are fresh and unexposed. Reuse their array,
            // retaining permutation read/write order for host-backed views.
            const first = output[0], second = output[1];
            source = output;
            source[0] = 0;
            source[1] = 0;
            source[permutation[0]] = first;
            source[permutation[1]] = second;
        } else {
            source = Array(sourceRank).fill(0) as number[];
            output.forEach((coordinate, axis) => {
                source[permutation[axis]] = coordinate;
            });
        }
        const offset = source.reduce(
            (current, coordinate, axis) => current * value.shape[axis] + coordinate,
            0,
        );
        return value.itemAt?.(offset) ?? value.items[offset];
    };
    return {
        kind: 'array',
        shape,
        itemAt,
        get items() {
            const size = shape.reduce((product, dimension) => product * dimension, 1);
            materialized ??= Array.from({ length: size }, (_, index) => itemAt(index));
            return materialized;
        },
    };
}

/** Materialize the finite rank-1 sources accepted by keyed sorting. */
export function sortByItems(value: RankValue, operation = 'sort by'): RankValue[] {
    if (isRankArray(value)) {
        if (value.shape.length !== 1) {
            throw new RankError(`${operation} expects a rank-1 collection`);
        }
        return arrayItems(value);
    }
    if (isRankQueue(value)) return [...value.items];
    if (isRankSet(value)) return [...value.entries.values()];
    if (isRankMultiset(value)) return [...value.values()];
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError(`${operation} requires a finite collection`);
        }
        return [...value.plan.iterate()];
    }
    throw new RankError(`${operation} expects a finite rank-1 collection`);
}

/** Sort already-computed key rows lexicographically and stably. */
export function sortByKeys(
    items: readonly RankValue[],
    keys: readonly (readonly RankValue[])[],
    operation = 'sort by',
    indices = false,
): RankArray {
    if (items.length !== keys.length) throw new RankError(`${operation} key count mismatch`);
    const width = keys[0]?.length ?? 0;
    if (keys.some(key => key.length !== width)) {
        throw new RankError(`${operation} keys must have one shape`);
    }
    const kinds = Array.from({ length: width }, (_, column) => {
        if (keys.length === 0) return undefined;
        const kind = orderedKind(keys[0][column]);
        for (let row = 1; row < keys.length; row += 1) {
            if (orderedKind(keys[row][column]) !== kind) {
                throw new RankError(`${operation} key values must have one comparable type`);
            }
        }
        return kind;
    });
    const entries = items.map((value, position) => ({ value, position, keys: keys[position] }));
    entries.sort((left, right) => {
        for (let column = 0; column < width; column += 1) {
            const order = compareOrderedValues(
                left.keys[column],
                right.keys[column],
                kinds[column]!,
            );
            if (order !== 0) return order;
        }
        return left.position - right.position;
    });
    return {
        kind: 'array',
        items: entries.map(entry => indices ? BigInt(entry.position) : entry.value),
        shape: [entries.length],
    };
}

/** Return stable indices that order a tensor along one axis. */
export function argsortAxis(value: RankValue, axis: number): RankArray {
    if (!isRankArray(value)) throw new RankError('argsort axis expects an array');
    if (axis < 0 || axis >= value.shape.length) {
        throw new RankError(`argsort axis out of bounds: ${axis}`, 'DimensionMismatch');
    }
    const shape = [...value.shape];
    const result = Array<RankValue>(arraySize(shape));
    const vectorShape = shape.filter((_, current) => current !== axis);
    const vectorCount = arraySize(vectorShape);
    for (let vector = 0; vector < vectorCount; vector += 1) {
        const fixed = coordinatesAt(vectorShape, vector);
        const source = Array(shape.length).fill(0) as number[];
        let fixedIndex = 0;
        for (let current = 0; current < shape.length; current += 1) {
            if (current !== axis) source[current] = fixed[fixedIndex++];
        }
        const values = Array.from({ length: shape[axis] }, (_, coordinate) => {
            source[axis] = coordinate;
            return value.itemAt?.(offsetAt(shape, source))
                ?? value.items[offsetAt(shape, source)];
        });
        const kind = sortableKind(values, 'argsort');
        const order = stableOrder(values, kind);
        for (let coordinate = 0; coordinate < shape[axis]; coordinate += 1) {
            source[axis] = coordinate;
            result[offsetAt(shape, source)] = BigInt(order[coordinate]);
        }
    }
    return { kind: 'array', items: result, shape };
}

function coordinatesAt(shape: readonly number[], index: number): number[] {
    const result = Array(shape.length).fill(0) as number[];
    for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
        result[axis] = index % shape[axis];
        index = Math.floor(index / shape[axis]);
    }
    return result;
}

export function lengthOfAxis(value: RankValue, axis: number): bigint {
    if (isRankArray(value)) {
        if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
        return BigInt(value.shape[axis]);
    }
    if (axis !== 0) throw new RankError(`value has no axis ${axis}`);
    if (typeof value === 'string' || isRankQueue(value) || isRankGraph(value) || isRankDsu(value)
        || isRankMultiset(value) || isRankSequence(value)) {
        return lengthOf(value);
    }
    throw new RankError('len axis expects text, an array, queue, multiset or sequence');
}

function shapeOf(value: RankValue): RankValue {
    const dimensions = isRankArray(value)
        ? value.shape.map(dimension => BigInt(dimension))
        : typeof value === 'string' || isRankQueue(value)
            || isRankMultiset(value) || isRankSequence(value)
            ? [lengthOf(value)]
            : undefined;
    if (!dimensions) {
        throw new RankError('shape expects text, an array, queue, multiset or sequence');
    }
    return { kind: 'array', items: dimensions, shape: [dimensions.length] };
}

function sortValue(value: RankValue): RankValue {
    if (typeof value === 'string') {
        return [...value].sort((left, right) =>
            compareOrderedValues(left, right, 'text')).join('');
    }
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError('sort expects text or a rank-1 array');
    }
    const items = arrayItems(value);
    const kind = sortableKind(items, 'sort');
    items.sort((left, right) => compareOrderedValues(left, right, kind));
    return { kind: 'array', items, shape: [items.length] };
}

function argsortValue(value: RankValue): RankArray {
    const items = typeof value === 'string'
        ? [...value]
        : isRankArray(value) && value.shape.length === 1
            ? arrayItems(value)
            : undefined;
    if (!items) throw new RankError('argsort expects text or a rank-1 array');
    const order = stableOrder(items, sortableKind(items, 'argsort'));
    return {
        kind: 'array',
        items: order.map(index => BigInt(index)),
        shape: [order.length],
    };
}

function uniqueValue(value: RankValue): RankValue {
    if (typeof value === 'string') return uniqueItems([...value]).join('');
    if (isRankArray(value)) {
        if (value.shape.length !== 1) throw new RankError('unique expects a rank-1 array');
        const items = uniqueItems(arrayItems(value));
        return { kind: 'array', items, shape: [items.length] };
    }
    if (isRankQueue(value)) return { kind: 'queue', items: uniqueItems(value.items) };
    if (isRankSet(value)) return value;
    if (isRankSequence(value)) {
        return sequence({
            name: `unique ${value.plan.name}`,
            size: { kind: 'unknown' },
            *iterate() {
                const seen = new Set<string>();
                for (const item of value.plan.iterate()) {
                    const key = setValueKey(item);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    yield item;
                }
            },
        });
    }
    throw new RankError('unique expects text or a collection');
}

function arrayItems(value: RankArray): RankValue[] {
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    return Array.from({ length: size }, (_, index) => value.itemAt?.(index) ?? value.items[index]);
}

function uniqueItems(items: readonly RankValue[]): RankValue[] {
    const seen = new Set<string>();
    return items.filter(item => {
        const key = setValueKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function sortableKind(items: readonly RankValue[], operation: string): OrderedKind {
    if (items.length === 0) return 'numeric';
    const kinds = new Set(items.map(orderedKind));
    if (kinds.size !== 1) {
        throw new RankError(`${operation} array elements must have one comparable type`);
    }
    return [...kinds][0];
}

function stableOrder(items: readonly RankValue[], kind: OrderedKind): number[] {
    return items
        .map((_, position) => position)
        .sort((left, right) =>
            compareOrderedValues(items[left], items[right], kind) || left - right);
}

function arraySize(shape: readonly number[]): number {
    return shape.reduce((product, dimension) => product * dimension, 1);
}

function offsetAt(shape: readonly number[], coordinates: readonly number[]): number {
    return coordinates.reduce(
        (offset, coordinate, axis) => offset * shape[axis] + coordinate,
        0,
    );
}

function reshape(value: RankValue, shapeValue: RankValue): RankValue {
    if (!isRankArray(shapeValue) || shapeValue.shape.length !== 1
        || !shapeValue.items.every(item => typeof item === 'bigint')) {
        throw new RankError('reshape shape must be a rank-1 integer array');
    }

    const shape = shapeValue.items.map(item => reshapeDimension(item as bigint));
    const expected = shape.reduce((product, dimension) => product * dimension, 1);
    const items = reshapeItems(value);
    if (items.length !== expected) {
        throw new RankError(
            `reshape shape ${shape.join(' ')} expects ${expected} elements, got ${items.length}`,
        );
    }
    return { kind: 'array', items, shape };
}

function reshapeDimension(value: bigint): number {
    if (value < 0n) throw new RankError(`reshape dimension must be nonnegative: ${value}`);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`reshape dimension is too large: ${value}`);
    }
    return Number(value);
}

function reshapeItems(value: RankValue): RankValue[] {
    if (typeof value === 'string') return [...value];
    if (isRankArray(value) || isRankQueue(value)) return [...value.items];
    if (isRankSequence(value)) {
        if (value.plan.size.kind === 'infinite') {
            throw new RankError('reshape requires a finite sequence');
        }
        return [...value.plan.iterate()];
    }
    throw new RankError('reshape expects text or a finite array, queue or sequence');
}

function lengthOf(value: RankValue): bigint {
    if (value instanceof RankDeque || value instanceof RankHeap) return BigInt(value.size);
    if (typeof value === 'string') return BigInt([...value].length);
    if (isRankArray(value)) return BigInt(value.shape[0] ?? 0);
    if (isRankQueue(value)) return BigInt(value.items.length);
    if (isRankSet(value)) return BigInt(value.entries.size);
    if (isRankCounter(value)) return BigInt(value.entries.size);
    if (isRankMultiset(value)) return BigInt(value.size);
    if (isRankObject(value)) return BigInt(value.entries.size);
    if (isRankGraph(value)) return BigInt(value.size);
    if (isRankDsu(value)) return BigInt(value.size);
    if (!isRankSequence(value)) throw new RankError('len expects text or a collection');
    if (value.plan.size.kind === 'infinite') {
        throw new RankError('len requires a finite sequence');
    }
    if (value.plan.size.kind === 'exact') return value.plan.size.value;
    let length = 0n;
    for (const _ of value.plan.iterate()) length += 1n;
    return length;
}

function fibonacciPlan(boundary?: Boundary, evenOnly = false): SequencePlan {
    return {
        name: evenOnly ? 'even fibonacci' : 'fibonacci',
        size: boundary
            ? { kind: 'exact', value: fibonacciSize(boundary, evenOnly) }
            : { kind: 'infinite' },
        *iterate() {
            let current = evenOnly ? 2n : 1n;
            let next = evenOnly ? 8n : 2n;
            while (!boundary || within(current, boundary)) {
                yield current;
                [current, next] = evenOnly
                    ? [next, 4n * next + current]
                    : [next, current + next];
            }
        },
        withUpperBound(limit, inclusive) {
            return fibonacciPlan({ limit, inclusive }, evenOnly);
        },
        withFilter(predicate: SequencePredicate) {
            if (predicate.optimizationKey === 'even') return fibonacciPlan(boundary, true);
            return undefined;
        },
    };
}

function within(value: bigint, boundary: Boundary): boolean {
    return boundary.inclusive ? value <= boundary.limit : value < boundary.limit;
}

function fibonacciSize(boundary: Boundary, evenOnly: boolean): bigint {
    let count = 0n;
    let current = evenOnly ? 2n : 1n;
    let next = evenOnly ? 8n : 2n;
    while (within(current, boundary)) {
        count += 1n;
        [current, next] = evenOnly
            ? [next, 4n * next + current]
            : [next, current + next];
    }
    return count;
}

function primePlan(boundary?: Boundary): SequencePlan {
    return {
        name: 'primes',
        size: boundary ? { kind: 'unknown' } : { kind: 'infinite' },
        iterate: () => primeIterator(boundary),
        contains(value) {
            const integer = membershipInteger(value);
            return integer !== undefined
                && (!boundary || within(integer, boundary))
                && primeMembership(integer);
        },
        at(index) {
            let current = 0n;
            for (const value of primeIterator(boundary)) {
                if (current === index) return value;
                current += 1n;
            }
            return undefined;
        },
        withUpperBound(limit, inclusive) {
            return primePlan({ limit, inclusive });
        },
    };
}

const membershipPrimes = [2n, 3n];

function membershipInteger(value: RankValue): bigint | undefined {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
        return BigInt(value);
    }
    return undefined;
}

function primeMembership(value: bigint): boolean {
    if (value < 2n) return false;
    extendMembershipPrimes(value);
    for (const prime of membershipPrimes) {
        if (prime * prime > value) return true;
        if (value % prime === 0n) return value === prime;
    }
    return true;
}

function extendMembershipPrimes(value: bigint): void {
    let candidate = membershipPrimes[membershipPrimes.length - 1] + 2n;
    while (membershipPrimes[membershipPrimes.length - 1] ** 2n <= value) {
        if (isPrime(candidate, membershipPrimes)) membershipPrimes.push(candidate);
        candidate += 2n;
    }
}

function* primeIterator(boundary?: Boundary): IterableIterator<bigint> {
    const found: bigint[] = [];
    for (let candidate = 2n; !boundary || within(candidate, boundary); candidate += 1n) {
        if (isPrime(candidate, found)) {
            found.push(candidate);
            yield candidate;
        }
    }
}

function isPrime(candidate: bigint, smallerPrimes: readonly bigint[]): boolean {
    for (const prime of smallerPrimes) {
        if (prime * prime > candidate) return true;
        if (candidate % prime === 0n) return false;
    }
    return true;
}
