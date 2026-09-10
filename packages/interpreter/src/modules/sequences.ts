import { RankError } from '../errors.js';
import { compareOrderedValues, orderedKind, type OrderedKind } from '../ordered.js';
import { sequence, windowValue } from '../sequence.js';
import { setValueKey } from '../set.js';
import {
    isRankArray,
    isRankCounter,
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
    transpose: () => native('transpose', 1, arguments_ => transposeValue(arguments_[0])),
    unique: () => native('unique', 1, arguments_ => uniqueValue(arguments_[0]), 1),
    window: () => native('window', 2, arguments_ => windowValue(arguments_[0], arguments_[1])),
    reshape: () => native('reshape', 2, arguments_ => reshape(arguments_[0], arguments_[1])),
    all: () => native('all', 1, arguments_ => booleanReduction(arguments_[0], 'all')),
    any: () => native('any', 1, arguments_ => booleanReduction(arguments_[0], 'any')),
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

function* collectionValues(value: RankValue, operation: string): IterableIterator<RankValue> {
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
        const source = Array(value.shape.length).fill(0) as number[];
        output.forEach((coordinate, axis) => {
            source[permutation[axis]] = coordinate;
        });
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
    if (typeof value === 'string' || isRankQueue(value)
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
    const kind = sortableKind(items);
    items.sort((left, right) => compareOrderedValues(left, right, kind));
    return { kind: 'array', items, shape: [items.length] };
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

function sortableKind(items: readonly RankValue[]): OrderedKind {
    if (items.length === 0) return 'numeric';
    const kinds = new Set(items.map(orderedKind));
    if (kinds.size !== 1) throw new RankError('sort array elements must have one comparable type');
    return [...kinds][0];
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
    if (typeof value === 'string') return BigInt([...value].length);
    if (isRankArray(value)) return BigInt(value.shape[0] ?? 0);
    if (isRankQueue(value)) return BigInt(value.items.length);
    if (isRankSet(value)) return BigInt(value.entries.size);
    if (isRankCounter(value)) return BigInt(value.entries.size);
    if (isRankMultiset(value)) return BigInt(value.size);
    if (isRankObject(value)) return BigInt(value.entries.size);
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
