import { RankError } from '../errors.js';
import { sequence, windowValue } from '../sequence.js';
import { setValueKey } from '../set.js';
import {
    isRankArray,
    isRankCounter,
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
    sort: () => native('sort', 1, arguments_ => sortValue(arguments_[0]), 1),
    unique: () => native('unique', 1, arguments_ => uniqueValue(arguments_[0]), 1),
    window: () => native('window', 2, arguments_ => windowValue(arguments_[0], arguments_[1])),
    reshape: () => native('reshape', 2, arguments_ => reshape(arguments_[0], arguments_[1])),
};

export function lengthOfAxis(value: RankValue, axis: number): bigint {
    if (isRankArray(value)) {
        if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
        return BigInt(value.shape[axis]);
    }
    if (axis !== 0) throw new RankError(`value has no axis ${axis}`);
    if (typeof value === 'string' || isRankQueue(value) || isRankSequence(value)) {
        return lengthOf(value);
    }
    throw new RankError('len axis expects text, an array, queue or sequence');
}

function shapeOf(value: RankValue): RankValue {
    const dimensions = isRankArray(value)
        ? value.shape.map(dimension => BigInt(dimension))
        : typeof value === 'string' || isRankQueue(value) || isRankSequence(value)
            ? [lengthOf(value)]
            : undefined;
    if (!dimensions) throw new RankError('shape expects text, an array, queue or sequence');
    return { kind: 'array', items: dimensions, shape: [dimensions.length] };
}

function sortValue(value: RankValue): RankValue {
    if (typeof value === 'string') return [...value].sort(compareText).join('');
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError('sort expects text or a rank-1 array');
    }
    const items = arrayItems(value);
    const kind = sortableKind(items);
    items.sort((left, right) => compareValues(left, right, kind));
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

type SortableKind = 'numeric' | 'text' | 'boolean' | 'symbol';

function sortableKind(items: readonly RankValue[]): SortableKind {
    if (items.length === 0) return 'numeric';
    const kinds = new Set(items.map(item => {
        if (typeof item === 'bigint' || typeof item === 'number') return 'numeric';
        if (typeof item === 'string') return 'text';
        if (typeof item === 'boolean') return 'boolean';
        if (typeof item === 'object' && item.kind === 'label') return 'symbol';
        throw new RankError('sort array elements must be scalar values');
    }));
    if (kinds.size !== 1) throw new RankError('sort array elements must have one comparable type');
    return [...kinds][0] as SortableKind;
}

function compareValues(left: RankValue, right: RankValue, kind: SortableKind): number {
    if (kind === 'numeric') {
        const a = left as bigint | number;
        const b = right as bigint | number;
        return a < b ? -1 : a > b ? 1 : 0;
    }
    if (kind === 'text') return compareText(left as string, right as string);
    if (kind === 'boolean') return Number(left as boolean) - Number(right as boolean);
    const a = (left as { name: string }).name;
    const b = (right as { name: string }).name;
    return compareText(a, b);
}

function compareText(left: string, right: string): number {
    const a = [...left];
    const b = [...right];
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const difference = (a[index].codePointAt(0) ?? 0) - (b[index].codePointAt(0) ?? 0);
        if (difference !== 0) return difference;
    }
    return a.length - b.length;
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
