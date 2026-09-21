import { checkpoint, interruptibleCallback } from '../interrupt.js';
import { FlatRecords, flatRecords } from '../flat.js';
import { ownedArray, derivedArray, readArrayItem } from '../array-storage.js';
import { MissingValueError, RankError } from '../errors.js';
import { RankDeque, RankHeap } from '../containers.js';
import { compareOrderedValues, orderedKind, type OrderedKind } from '../ordered.js';
import { materializeSequence, sequence, takeDropValue, windowValue } from '../sequence.js';
import { RankPersistentSumSegment, RankRangeSumSegment } from '../segment.js';
import { setValueKey } from '../set.js';
import { chooseSqlite, lengthSqlite, uniqueSqlite } from './sqlite.js';
import { broadcastShape } from '../tensor.js';
import { isKnownFileFree } from '../resource-summary.js';
import {
    isRankArray,
    isRankCounter,
    isRankGraph,
    isRankDsu,
    isRankMultiset,
    isRankObject,
    isRankQueue,
    isRankSequence,
    isRankSqliteExpression,
    isRankSqliteTable,
    isRankTableAlias,
    isRankSegment,
    isRankWavelet,
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
    flat: () => native('flat', [1, 2], flatRecords),
    choose: () => native('choose', 3, ([condition, whenTrue, whenFalse]) =>
        chooseValue(condition, whenTrue, whenFalse)),
    fibonacci: () => sequence(fibonacciPlan()),
    primes: () => sequence(primePlan()),
    take: () => native('take', 2, ([source, count]) => takeDropValue(source, count)),
    drop: () => native('drop', 2, ([source, count]) => takeDropValue(source, count, true)),
    shape: () => native('shape', 1, arguments_ => shapeOf(arguments_[0])),
    copy: () => native('copy', 1, arguments_ =>
        arguments_[0] instanceof FlatRecords
        || arguments_[0] instanceof RankRangeSumSegment
        || arguments_[0] instanceof RankPersistentSumSegment
            ? arguments_[0].copy()
            : copyArray(arguments_[0])),
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
    unique: () => native('unique', 1, arguments_ => isRankSqliteTable(arguments_[0])
        ? uniqueSqlite(arguments_[0]) : uniqueValue(arguments_[0]), 1),
    window: () => native('window', 2, arguments_ => windowValue(arguments_[0], arguments_[1])),
    reshape: () => native('reshape', 2, arguments_ => reshape(arguments_[0], arguments_[1])),
    all: () => native('all', 1, arguments_ => booleanReduction(arguments_[0], 'all')),
    any: () => native('any', 1, arguments_ => booleanReduction(arguments_[0], 'any')),
    count: () => native('count', 1, arguments_ => countTrue(arguments_[0])),
    find: () => native('find', 2, arguments_ => findValue(arguments_[0], arguments_[1])),
    findall: () => native('findall', 2, arguments_ => findAllValues(arguments_[0], arguments_[1])),
    indices: () => native('indices', 1, arguments_ => trueIndices(arguments_[0])),
};

function chooseValue(condition: RankValue, whenTrue: RankValue, whenFalse: RankValue): RankValue {
    const values = [condition, whenTrue, whenFalse];
    if (values.some(isRankSqliteExpression)) {
        return chooseSqlite(condition, whenTrue, whenFalse);
    }
    const arrays = values.filter(isRankArray);
    if (arrays.length === 0) {
        if (typeof condition !== 'boolean') {
            throw new RankError('choose expects a boolean condition', 'TypeError');
        }
        return condition ? whenTrue : whenFalse;
    }
    const shape = arrays.reduce<readonly number[]>(
        (current, array) => broadcastShape(current, array.shape), []);
    const read = (value: RankValue, index: number): RankValue => {
        if (!isRankArray(value)) return value;
        let remaining = index;
        let offset = 0;
        let stride = 1;
        for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
            const coordinate = remaining % shape[axis];
            remaining = Math.floor(remaining / shape[axis]);
            const sourceAxis = axis - (shape.length - value.shape.length);
            if (sourceAxis < 0) continue;
            if (value.shape[sourceAxis] !== 1) offset += coordinate * stride;
            stride *= value.shape[sourceAxis];
        }
        return readArrayItem(value, offset);
    };
    const fileFree = [whenTrue, whenFalse].every(value => isKnownFileFree(value)
        || (isRankArray(value) && value.containsFiles === false));
    return derivedArray(shape, arrays, index => {
        const selected = read(condition, index);
        if (typeof selected !== 'boolean') {
            throw new RankError('choose expects a boolean condition', 'TypeError');
        }
        return read(selected ? whenTrue : whenFalse, index);
    }, fileFree);
}

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
    if (isRankSequence(value)) {
        const planned = value.plan.reduce?.('count');
        if (planned !== undefined) {
            if (typeof planned !== 'bigint') {
                throw new RankError('count plan must return an integer');
            }
            return planned;
        }
    }
    let count = 0n;
    for (const item of collectionValues(value, 'count')) {
        if (typeof item !== 'boolean') {
            throw new RankError('count expects boolean values', 'TypeError');
        }
        if (item) count += 1n;
    }
    return count;
}

function trueIndices(value: RankValue): RankArray {
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError('indices expects a rank-1 array', 'TypeError');
    }
    const positions: bigint[] = [];
    for (let index = 0; index < value.shape[0]; index += 1) {
        const item = readArrayItem(value, index);
        if (typeof item !== 'boolean') {
            throw new RankError('indices expects boolean values', 'TypeError');
        }
        if (item) positions.push(BigInt(index));
    }
    return ownedArray(positions, [positions.length]);
}

function findValue(source: RankValue, target: RankValue): bigint {
    const values = findSource(source, 'find');
    const targetKey = setValueKey(target);
    let index = 0n;
    for (const value of values) {
        if (setValueKey(value) === targetKey) return index;
        index += 1n;
    }
    throw new MissingValueError('find found no matching value');
}

function findAllValues(source: RankValue, target: RankValue): RankArray {
    const values = findSource(source, 'findall');
    const targetKey = setValueKey(target);
    const positions: bigint[] = [];
    let index = 0n;
    for (const value of values) {
        if (setValueKey(value) === targetKey) positions.push(index);
        index += 1n;
    }
    return ownedArray(positions, [positions.length]);
}

function* findSource(source: RankValue, operation: string): IterableIterator<RankValue> {
    if (typeof source === 'string') {
        yield* source;
        return;
    }
    if (!isRankArray(source) || source.shape.length !== 1) {
        throw new RankError(`${operation} expects text or a rank-1 array`, 'TypeError');
    }
    for (let index = 0; index < source.shape[0]; index += 1) yield readArrayItem(source, index);
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
    if (isRankSequence(value)) return materializeSequence(value);
    if (!isRankArray(value)) throw new RankError('copy expects an array or sequence');
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    const items = Array.from(
        { length: size },
        (_, index) => value.itemAt?.(index) ?? value.items[index],
    );
    return ownedArray(items, value.shape);
}

export function transposeValue(value: RankValue, axes?: readonly number[]): RankValue {
    if (isRankSequence(value)) {
        throw new RankError('transpose expects an array; use copy to materialize the sequence');
    }
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
    return derivedArray(shape, [value], itemAt);
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
    if (isRankCounter(value)) return Array.from(value.entries.values(), entry => entry.value);
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
    keys: readonly (readonly (RankValue | undefined)[])[],
    operation = 'sort by',
    indices = false,
    descending: readonly boolean[] = [],
): RankArray {
    if (items.length !== keys.length) throw new RankError(`${operation} key count mismatch`);
    const width = keys[0]?.length ?? 0;
    if (keys.some(key => key.length !== width)) {
        throw new RankError(`${operation} keys must have one shape`);
    }
    const kinds = Array.from({ length: width }, (_, column) => {
        const first = keys.find(row => row[column] !== undefined)?.[column];
        if (first === undefined) return undefined;
        const kind = orderedKind(first);
        for (const row of keys) {
            const value = row[column];
            if (value !== undefined && orderedKind(value) !== kind) {
                throw new RankError(`${operation} key values must have one comparable type`);
            }
        }
        return kind;
    });
    const entries = items.map((value, position) => ({ value, position, keys: keys[position] }));
    entries.sort(interruptibleCallback((left, right) => {
        for (let column = 0; column < width; column += 1) {
            const a = left.keys[column];
            const b = right.keys[column];
            if (a === undefined || b === undefined) {
                if (a !== b) return a === undefined ? 1 : -1;
                continue;
            }
            const order = compareOrderedValues(a, b, kinds[column]!);
            if (order !== 0) return descending[column] ? -order : order;
        }
        return left.position - right.position;
    }, 'sorting'));
    const result = ownedArray(entries.map(entry => indices ? BigInt(entry.position) : entry.value));
    if (!indices) Object.defineProperty(result, 'sortKeys', { value: entries.map(entry => entry.keys) });
    return result;
}

/** Return stable indices that order a tensor along one axis. */
export function argsortAxis(value: RankValue, axis: number, descending = false): RankArray {
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
        const order = stableOrder(values, kind, descending);
        for (let coordinate = 0; coordinate < shape[axis]; coordinate += 1) {
            source[axis] = coordinate;
            result[offsetAt(shape, source)] = BigInt(order[coordinate]);
        }
    }
    return ownedArray(result, shape);
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
        || isRankSegment(value) || isRankWavelet(value)
        || isRankMultiset(value) || isRankSequence(value)) {
        return lengthOf(value);
    }
    throw new RankError('len axis expects text, an array, queue, multiset or sequence');
}

function shapeOf(value: RankValue): RankValue {
    const dimensions = isRankArray(value)
        ? value.shape.map(dimension => BigInt(dimension))
        : typeof value === 'string' || isRankQueue(value)
            || isRankMultiset(value) || isRankSegment(value)
            || isRankWavelet(value) || isRankSequence(value)
            ? [lengthOf(value)]
            : undefined;
    if (!dimensions) {
        throw new RankError('shape expects text, an array, queue, multiset or sequence');
    }
    return ownedArray(dimensions);
}

export function sortValue(value: RankValue, descending = false): RankValue {
    const direction = descending ? -1 : 1;
    if (typeof value === 'string') {
        return [...value].sort(interruptibleCallback((left, right) =>
            direction * compareOrderedValues(left, right, 'text'), 'sorting')).join('');
    }
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError('sort expects text or a rank-1 array');
    }
    const items = arrayItems(value);
    const kind = sortableKind(items, 'sort');
    items.sort(interruptibleCallback((left, right) => direction * compareOrderedValues(left, right, kind), 'sorting'));
    return ownedArray(items);
}

export function argsortValue(value: RankValue, descending = false): RankArray {
    const items = typeof value === 'string'
        ? [...value]
        : isRankArray(value) && value.shape.length === 1
            ? arrayItems(value)
            : undefined;
    if (!items) throw new RankError('argsort expects text or a rank-1 array');
    const order = stableOrder(items, sortableKind(items, 'argsort'), descending);
    return ownedArray(order.map(index => BigInt(index)));
}

function uniqueValue(value: RankValue): RankValue {
    if (typeof value === 'string') return uniqueItems([...value]).join('');
    if (isRankArray(value)) {
        if (value.shape.length !== 1) throw new RankError('unique expects a rank-1 array');
        if (value.columnNames) {
            const seen = new Set<string>();
            const items = arrayItems(value).filter(row => {
                if (!isRankObject(row)) throw new RankError('table unique expects object rows', 'TypeError');
                const key = JSON.stringify(value.columnNames!.map(name => {
                    const cell = row.entries.get(name);
                    return cell === undefined ? null : setValueKey(cell);
                }));
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const result = ownedArray(items);
            Object.defineProperty(result, 'columnNames', { value: value.columnNames });
            return result;
        }
        const items = uniqueItems(arrayItems(value));
        return ownedArray(items);
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

function stableOrder(items: readonly RankValue[], kind: OrderedKind, descending = false): number[] {
    return items
        .map((_, position) => position)
        .sort(interruptibleCallback((left, right) =>
            (descending ? -1 : 1) * compareOrderedValues(items[left], items[right], kind) || left - right, 'sorting'));
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
    return ownedArray(items, shape);
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

export function lengthOf(value: RankValue): bigint {
    if (isRankTableAlias(value)) return lengthOf(value.source);
    if (isRankSqliteTable(value)) return lengthSqlite(value);
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
    if (isRankSegment(value)) return BigInt(value.size);
    if (isRankWavelet(value)) return BigInt(value.size);
    if (!isRankSequence(value)) throw new RankError('len expects text or a collection');
    if (value.plan.size.kind === 'infinite') {
        throw new RankError('len requires a finite sequence');
    }
    if (value.plan.size.kind === 'exact') return value.plan.size.value;
    let length = 0n;
    for (const _ of value.plan.iterate()) length += 1n;
    return length;
}

function fibonacciPlan(
    boundary?: Boundary,
    evenOnly = false,
    lower?: Boundary,
): SequencePlan {
    return {
        name: evenOnly ? 'even fibonacci' : 'fibonacci',
        size: boundary
            ? { kind: 'exact', value: fibonacciSize(boundary, evenOnly, lower) }
            : { kind: 'infinite' },
        contains(value) {
            const integer = membershipInteger(value);
            if (integer === undefined || integer < 1n
                || (boundary && !within(integer, boundary))
                || (lower && !above(integer, lower))) return false;
            let current = evenOnly ? 2n : 1n;
            let next = evenOnly ? 8n : 2n;
            while (current < integer) {
                checkpoint('testing fibonacci membership');
                [current, next] = evenOnly
                    ? [next, 4n * next + current]
                    : [next, current + next];
            }
            return current === integer;
        },
        *iterate() {
            let current = evenOnly ? 2n : 1n;
            let next = evenOnly ? 8n : 2n;
            while (!boundary || within(current, boundary)) {
                checkpoint('reading sequence');
                if (!lower || above(current, lower)) yield current;
                [current, next] = evenOnly
                    ? [next, 4n * next + current]
                    : [next, current + next];
            }
        },
        withUpperBound(limit, inclusive) {
            return fibonacciPlan({ limit, inclusive }, evenOnly, lower);
        },
        withLowerBound(limit, inclusive) {
            return fibonacciPlan(
                boundary,
                evenOnly,
                strongerLower(lower, { limit, inclusive }),
            );
        },
        withFilter(predicate: SequencePredicate) {
            if (predicate.optimizationKey === 'even') {
                return fibonacciPlan(boundary, true, lower);
            }
            return undefined;
        },
    };
}

function within(value: bigint, boundary: Boundary): boolean {
    return boundary.inclusive ? value <= boundary.limit : value < boundary.limit;
}

function above(value: bigint, boundary: Boundary): boolean {
    return boundary.inclusive ? value >= boundary.limit : value > boundary.limit;
}

function strongerLower(left: Boundary | undefined, right: Boundary): Boundary {
    if (!left || right.limit > left.limit) return right;
    if (left.limit > right.limit) return left;
    return { limit: left.limit, inclusive: left.inclusive && right.inclusive };
}

function fibonacciSize(
    boundary: Boundary,
    evenOnly: boolean,
    lower?: Boundary,
): bigint {
    let count = 0n;
    let current = evenOnly ? 2n : 1n;
    let next = evenOnly ? 8n : 2n;
    while (within(current, boundary)) {
        checkpoint('reading sequence');
        if (!lower || above(current, lower)) count += 1n;
        [current, next] = evenOnly
            ? [next, 4n * next + current]
            : [next, current + next];
    }
    return count;
}

function primePlan(boundary?: Boundary, lower?: Boundary): SequencePlan {
    return {
        name: 'primes',
        size: boundary ? { kind: 'unknown' } : { kind: 'infinite' },
        iterate: () => primeIterator(boundary, lower),
        contains(value) {
            const integer = membershipInteger(value);
            return integer !== undefined
                && (!boundary || within(integer, boundary))
                && (!lower || above(integer, lower))
                && primeMembership(integer);
        },
        at(index) {
            let current = 0n;
            for (const value of primeIterator(boundary, lower)) {
                if (current === index) return value;
                current += 1n;
            }
            return undefined;
        },
        withUpperBound(limit, inclusive) {
            return primePlan({ limit, inclusive }, lower);
        },
        withLowerBound(limit, inclusive) {
            return primePlan(boundary, strongerLower(lower, { limit, inclusive }));
        },
    };
}

const membershipPrimes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n];

function membershipInteger(value: RankValue): bigint | undefined {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
        return BigInt(value);
    }
    return undefined;
}

function primeMembership(value: bigint): boolean {
    if (value < 2n) return false;
    for (const prime of membershipPrimes) {
        if (prime * prime > value) return true;
        if (value % prime === 0n) return value === prime;
    }
    // Reject known factors before generating any more trial divisors.
    // Only newly generated primes need checking after the extension.
    const checked = membershipPrimes.length;
    extendMembershipPrimes(value);
    for (let index = checked; index < membershipPrimes.length; index += 1) {
        const prime = membershipPrimes[index];
        if (prime * prime > value) return true;
        if (value % prime === 0n) return false;
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

function* primeIterator(
    boundary?: Boundary,
    lower?: Boundary,
): IterableIterator<bigint> {
    if (lower) {
        let candidate = lower.limit;
        if (!lower.inclusive) candidate += 1n;
        if (candidate <= 2n) {
            if (!boundary || within(2n, boundary)) yield 2n;
            candidate = 3n;
        }
        if (candidate % 2n === 0n) candidate += 1n;
        for (; !boundary || within(candidate, boundary); candidate += 2n) {
            checkpoint('reading sequence');
            if (primeMembership(candidate)) yield candidate;
        }
        return;
    }
    const found: bigint[] = [];
    for (let candidate = 2n; !boundary || within(candidate, boundary); candidate += 1n) {
        checkpoint('reading sequence');
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
