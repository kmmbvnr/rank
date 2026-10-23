import { copyArrayStorage } from '../array-copy.js';
import { materializePackedBooleans, packedTruePositions } from '../packed-booleans.js';
import { permutedArray } from '../array-permutation.js';
import { findValue, findAllValues } from './sequence-search.js';
import { materializeValue } from '../materialize.js';
import { numericSort } from '../numeric-collections.js';
import { reshapeDimensions } from '../tensor-layout.js';
import { sortValue, argsortValue, sortableKind, stableOrder } from './sequence-order.js';
export { sortValue, argsortValue, sortByKeys } from './sequence-order.js';
import { uniqueValue } from './sequence-distinct.js';
export { uniqueLength } from './sequence-distinct.js';
import { densePrimePlan } from '../dense-prime-sieve.js';
import { primePlan } from '../prime-sequence.js';
import { registerSequenceMembership } from '../sequence-membership.js';
import { above, within, strongerLower, strongerUpper, membershipInteger, type Boundary } from '../sequence-bounds.js';
import { concatArrays } from '../concat-array.js';
import { orderedSource } from '../ordered-source.js';
import { collectionSize } from '../collection-size.js';
import { elementSource } from '../element-source.js';
import { inheritArrayDeclaration } from '../array-declaration.js';
import { semanticArrayType, setSemanticArrayType } from '../semantic-array-type.js';
import { checkpoint, inspectionEnabled, privateLoopPolling } from '../interrupt.js';
import { prepareIntegerView } from '../integer-view.js';
import { FlatRecords, flatRecords } from '../flat.js';
import { ownedArray, derivedArray, denseScalarItems, copyStoredNumericArray, copyMaterializedArrayItems, arrayValueTraversal, collectArrayCells, prepareArrayRead, readArrayItem, reshapeStoredArray } from '../array-storage.js';
import { MissingValueError, RankError } from '../errors.js';
import { RankDeque, RankHeap } from '../containers.js';
import { atSequence, materializeSequence, sequenceArrayOperand, sequence, shiftValue, stackItems, windowValue } from '../sequence.js';
import { atArray } from '../selectors.js';
import { RankPersistentSumSegment, RankRangeSumSegment } from '../segment.js';
import { chooseSqlite, lengthSqlite, uniqueSqlite } from './sqlite.js';
import { mergeSorted } from './sorted-merge.js';
import { broadcastShape, chooseDenseArrays } from '../tensor.js';
import { isKnownFileFree } from '../resource-summary.js';
import {
    MISSING,
    isRankArray,
    isRankCounter,
    isRankMultiset,
    isRankQueue,
    isRankSequence,
    isRankSqliteExpression,
    isRankSqliteTable,
    isRankTableAlias,
    isRankSet,
    isRankLabel,
    tuple,
    type NativeFunction,
    type RankArray,
    type RankSequence,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
} from '../value.js';
import type { Operators } from '../operators.js';
import { assignRecordField } from '../record-write.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const sequencesModule: RuntimeModule = {
    flat: () => native('flat', [1, 2], flatRecords),
    fibonacci: () => sequence(fibonacciPlan()),
    primes: () => sequence(primePlan()),
    primesieve: () => native('primesieve', 1, args => sequence(densePrimePlan(args[0]))),
    shape: () => native('shape', 1, arguments_ => shapeOf(arguments_[0])),
    copy: () => native('copy', 1, arguments_ =>
        arguments_[0] instanceof FlatRecords
        || arguments_[0] instanceof RankRangeSumSegment
        || arguments_[0] instanceof RankPersistentSumSegment
            ? arguments_[0].copy()
            : copyArray(arguments_[0])),
    sort: () => native('sort', [1, 2], arguments_ => sortValue(arguments_[0])),
    argsort: () => native(
        'argsort',
        [1, 2],
        arguments_ => argsortValue(arguments_[0]),
    ),
    merge: () => native('merge', [1, 2], arguments_ => mergeSorted(arguments_, false)),
    transpose: () => native('transpose', 1, arguments_ => transposeValue(arguments_[0])),
    unique: () => native('unique', 1, arguments_ => isRankSqliteTable(arguments_[0])
        ? uniqueSqlite(arguments_[0]) : uniqueValue(arguments_[0])),
    window: () => native('window', 2, arguments_ => windowValue(arguments_[0], arguments_[1])),
    shift: () => native('shift', 2, arguments_ => shiftValue(arguments_[0], arguments_[1])),
    reshape: () => native('reshape', 1, () => {
        throw new RankError('reshape dimensions must follow reshape');
    }),
    all: () => native('all', 1, arguments_ => booleanReduction(arguments_[0], 'all')),
    any: () => native('any', 1, arguments_ => booleanReduction(arguments_[0], 'any')),
    count: () => native('count', 1, arguments_ => countTrue(arguments_[0])),
    find: () => native('find', 2, arguments_ => findValue(arguments_[0], arguments_[1])),
    findall: () => native('findall', 2, arguments_ => findAllValues(arguments_[0], arguments_[1])),
    indices: () => native('indices', 1, arguments_ => trueIndices(arguments_[0])),
    reverse: () => native('reverse', 1, arguments_ => reverseValue(arguments_[0])),
    first: () => native('first', 1, arguments_ => endItem(arguments_[0], false)),
    last: () => native('last', 1, arguments_ => endItem(arguments_[0], true)),
};

/**
 * `Values reverse`: text by code point, an array along its leading axis, or a
 * queue, stack, deque or finite sequence as an array; a queue is left in place. The result is a new value; typed storage stays typed.
 */
function reverseValue(value: RankValue): RankValue {
    const source = orderedSource(value, 'ordered', 'reverse');
    if (!source?.reverse) throw new RankError('reverse expects text, an array, a queue or a finite sequence', 'TypeError');
    return source.reverse();
}

/** `Values first` and `Values last`: an end of the leading axis, missing when it is empty. */
function endItem(value: RankValue, back: boolean): RankValue {
    const name = back ? 'last' : 'first';
    const source = orderedSource(value, 'ordered', name);
    if (!source?.end) throw new RankError(`${name} expects text, an array, queue or finite sequence`, 'TypeError');
    return source.end(back);
}

export function chooseValue(condition: RankValue, whenTrue: RankValue, whenFalse: RankValue): RankValue {
    let values = [condition, whenTrue, whenFalse];
    if (values.some(isRankSqliteExpression)) {
        return chooseSqlite(condition, whenTrue, whenFalse);
    }
    // A scalar condition can select a whole stream without inspecting either branch.
    if (typeof condition === 'boolean' && !values.some(isRankArray)) {
        return condition ? whenTrue : whenFalse;
    }
    values = values.map(sequenceArrayOperand);
    [condition, whenTrue, whenFalse] = values;
    const arrays = values.filter(isRankArray);
    if (arrays.length === 0) {
        if (typeof condition !== 'boolean') {
            throw new RankError('choose expects a boolean condition', 'TypeError');
        }
        return condition ? whenTrue : whenFalse;
    }
    const shape = arrays.reduce<readonly number[]>(
        (current, array) => broadcastShape(current, array.shape), []);
    const read = (value: RankValue, index: number): RankValue => broadcastRead(shape, value, index);
    const dense = chooseDenseArrays(condition, whenTrue, whenFalse, shape);
    if (dense) return dense;
    const fileFree = [whenTrue, whenFalse].every(value => isKnownFileFree(value)
        || (isRankArray(value) && value.containsFiles === false));
    return derivedArray(shape, values, index => {
        const selected = read(condition, index);
        if (typeof selected !== 'boolean') {
            throw new RankError('choose expects a boolean condition', 'TypeError');
        }
        return read(selected ? whenTrue : whenFalse, index);
    }, fileFree);
}

/** The item of `value` at a flat position of `shape`, which it broadcasts to by trailing axes. */
function broadcastRead(shape: readonly number[], value: RankValue, index: number, base = 0,
    valueShape: readonly number[] | undefined = isRankArray(value) ? value.shape : undefined): RankValue {
    if (!isRankArray(value) || !valueShape) return value;
    let remaining = index;
    let offset = 0;
    let stride = 1;
    for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
        const coordinate = remaining % shape[axis];
        remaining = Math.floor(remaining / shape[axis]);
        const sourceAxis = axis - (shape.length - valueShape.length);
        if (sourceAxis < 0) continue;
        if (valueShape[sourceAxis] !== 1) offset += coordinate * stride;
        stride *= valueShape[sourceAxis];
    }
    return readArrayItem(value, base + offset);
}

/**
 * `Index Choices choose`: each cell of the integer index names the choice,
 * a leading-axis cell of `Choices`, to read at that position. Index and choices
 * broadcast by trailing axes, and only the chosen value is read at each cell.
 */
export function chooseIndexed(index: RankValue, choices: RankValue): RankValue {
    if (!isRankArray(choices) || choices.shape.length === 0) {
        throw new RankError('choose expects an array of choices', 'TypeError');
    }
    const count = choices.shape[0];
    const cellShape = choices.shape.slice(1);
    const cellSize = cellShape.reduce((product, size) => product * size, 1);
    // A rank-1 array holds whole choices; a higher-rank array holds one per leading cell.
    const nested = cellShape.length === 0;
    const candidates = nested ? Array.from({ length: count }, (_, k) => readArrayItem(choices, k)) : [];
    const pick = (selected: RankValue): number => {
        if (typeof selected !== 'bigint') throw new RankError('choose expects integer indices', 'TypeError');
        if (selected < 0n || selected >= BigInt(count)) {
            throw new MissingValueError(`choose index out of bounds: ${selected}`);
        }
        return Number(selected);
    };
    const shapes = [
        ...(isRankArray(index) ? [index.shape] : []),
        ...(nested ? candidates.filter(isRankArray).map(candidate => candidate.shape) : [cellShape]),
    ];
    if (shapes.length === 0) return candidates[pick(index)];
    const shape = shapes.reduce<readonly number[]>((current, next) => broadcastShape(current, next), []);
    const sources = [index, ...candidates, choices].filter(isRankArray);
    const fileFree = isKnownFileFree(choices) || choices.containsFiles === false;
    return derivedArray(shape, sources, position => {
        const k = pick(broadcastRead(shape, index, position));
        return nested
            ? broadcastRead(shape, candidates[k], position)
            : broadcastRead(shape, choices, position, k * cellSize, cellShape);
    }, fileFree);
}

function booleanReduction(value: RankValue, operation: 'all' | 'any'): boolean {
    const planned = elementSource(value, operation, 'booleans')?.reduce?.(operation);
    if (planned !== undefined) {
        if (typeof planned !== 'boolean') throw new RankError(`${operation} plan must return a boolean`);
        return planned;
    }
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
    {
        const planned = elementSource(value, 'count', 'booleans')?.reduce?.('count');
        if (planned !== undefined) {
            if (typeof planned !== 'bigint') {
                throw new RankError('count plan must return an integer');
            }
            return planned;
        }
    }
    let count = 0n;
    for (const item of collectionValues(value, 'count')) {
        if (item === MISSING) continue;
        if (typeof item !== 'boolean') {
            throw new RankError('count expects boolean values', 'TypeError');
        }
        if (item) count += 1n;
    }
    return count;
}

function trueIndices(value: RankValue): RankArray {
    if (!isRankArray(value) || value.shape.length === 0) {
        throw new RankError('indices expects an array of rank at least 1', 'TypeError');
    }
    const positions: bigint[] = [];
    const rank = value.shape.length;
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    const packed = packedTruePositions(value);
    if (packed) {
        for (const index of packed) {
            if (rank === 1) positions.push(BigInt(index));
            else for (const coordinate of coordinatesAt(value.shape, index)) positions.push(BigInt(coordinate));
        }
        return ownedArray(positions, rank === 1 ? [positions.length] : [positions.length / rank, rank]);
    }
    for (let index = 0; index < size; index += 1) {
        if (index % 4096 === 0) checkpoint('finding indices');
        const item = readArrayItem(value, index);
        if (typeof item !== 'boolean') {
            throw new RankError('indices expects boolean values', 'TypeError');
        }
        if (item) {
            if (rank === 1) positions.push(BigInt(index));
            else for (const coordinate of coordinatesAt(value.shape, index)) positions.push(BigInt(coordinate));
        }
    }
    return ownedArray(positions, rank === 1 ? [positions.length] : [positions.length / rank, rank]);
}

function* collectionValues(value: RankValue, operation: string): IterableIterator<RankValue> {
    const source = elementSource(value, operation, 'booleans');
    yield* source ? source.values() : [value];
}

export function copyArray(value: RankValue): RankArray {
    if (isRankSequence(value)) return materializeSequence(value);
    if (!isRankArray(value)) throw new RankError('copy expects an array or sequence');
    const type = semanticArrayType(value);
    const planned = copyArrayStorage(value);
    if (planned) return planned;
    const numeric = privateLoopPolling() ? copyStoredNumericArray(value) : undefined;
    if (numeric) { inheritArrayDeclaration(value, numeric); return setSemanticArrayType(numeric, type); }
    const packed = materializePackedBooleans(value);
    if (packed) { inheritArrayDeclaration(value, packed); return setSemanticArrayType(packed, type); }
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    const copied = inspectionEnabled() ? undefined : copyMaterializedArrayItems(value, size);
    const integers = copied || inspectionEnabled() ? undefined : prepareIntegerView(value, true);
    const traverse = copied || integers ? undefined : arrayValueTraversal(value);
    const prepared = copied || integers || traverse || inspectionEnabled() ? undefined : prepareArrayRead(value);
    const items = copied ?? (traverse ? collectArrayCells(value) : Array.from(
        { length: size },
        (_, index) => {
            if (integers) { checkpoint('copying integers'); return integers.read(index); }
            if (prepared) { checkpoint('copying array'); return prepared(index); }
            return value.itemAt?.(index) ?? value.items[index];
        },
    ));
    // Cells that are arrays or finite sequences stack along new trailing axes, as sequence items do.
    if (!items.some(item => isRankArray(item) || isRankSequence(item))) {
        const result = ownedArray(items, value.shape, false, value.columnNames);
        inheritArrayDeclaration(value, result);
        return setSemanticArrayType(result, type);
    }
    const cells = items.map(item => isRankSequence(item) ? materializeSequence(item) : item);
    return stackItems(cells, value.shape, 'array');
}

/**
 * `stack A B axis N`: lazily join equally shaped arrays or sequences on a new axis.
 * Shapes are checked when the view is made; cells are read on demand.
 */
export function stackValues(values: readonly RankValue[], axis = 0): RankArray {
    const size = values.length;
    const mismatch = (message: string) => new RankError(message, 'DimensionMismatch');
    if (!Number.isSafeInteger(axis) || axis < 0) throw mismatch('stack axis must be a nonnegative integer');
    const readers: ((index: number) => RankValue)[] = [];
    const dependencies: RankArray[] = [];
    let cellShape: readonly number[] | undefined;
    for (let position = 0; position < size; position += 1) {
        checkpoint('stacking items');
        let item = values[position]!;
        let shape: readonly number[];
        if (isRankSequence(item)) {
            const length = item.plan.size;
            if (length.kind === 'infinite') throw new RankError('cannot stack an infinite sequence');
            if (length.kind === 'unknown') {
                throw new RankError('cannot stack a sequence of unknown size; use copy', 'TypeError');
            }
            if (!item.plan.at) item = materializeSequence(item);
        }
        if (isRankSequence(item)) {
            const source = item;
            shape = [Number(source.plan.size.kind === 'exact' ? source.plan.size.value : 0n)];
            for (const capture of source.plan.captures ?? []) {
                for (const captured of capture.values()) if (isRankArray(captured)) dependencies.push(captured);
            }
            readers.push(index => atSequence(source, BigInt(index)));
        } else if (isRankArray(item)) {
            const source = item;
            shape = source.shape;
            dependencies.push(source);
            readers.push(index => readArrayItem(source, index));
        } else {
            throw mismatch('stack items must all be arrays or sequences');
        }
        cellShape ??= shape;
        if (cellShape.length !== shape.length || cellShape.some((dimension, axis) => dimension !== shape[axis])) {
            throw mismatch('stack items must have the same shape');
        }
    }
    if (cellShape === undefined) {
        if (axis !== 0) throw mismatch(`stack axis ${axis} exceeds result rank 1`);
        return ownedArray([], [0]);
    }
    if (axis > cellShape.length) throw mismatch(`stack axis ${axis} exceeds result rank ${cellShape.length + 1}`);
    if (axis === 0) {
        const cellSize = cellShape.reduce((product, dimension) => product * dimension, 1);
        return derivedArray([size, ...cellShape], dependencies, index =>
            readers[Math.floor(index / cellSize)]!(index % cellSize));
    }
    const shape = [...cellShape];
    shape.splice(axis, 0, size);
    return derivedArray(shape, dependencies, index => {
        const coordinates = coordinatesAt(shape, index);
        const source = coordinates.splice(axis, 1)[0]!;
        return readers[source]!(offsetAt(cellShape, coordinates));
    });
}

const concatPlans = new WeakMap<SequencePlan, {
    sources: readonly (RankArray | RankSequence)[];
    iterate: SequencePlan['iterate'];
}>();

function* concatItems(sources: readonly (RankArray | RankSequence)[]): Generator<RankValue> {
    const pending = [sources[Symbol.iterator]()];
    while (pending.length) {
        checkpoint('concatenating items');
        const next = pending[pending.length - 1].next();
        if (next.done) { pending.pop(); continue; }
        const source = next.value;
        if (isRankSequence(source)) {
            const nested = concatPlans.get(source.plan);
            if (nested && nested.iterate === source.plan.iterate) pending.push(nested.sources[Symbol.iterator]());
            else yield* source.plan.iterate();
        } else {
            for (let index = 0; index < source.shape[0]; index++) {
                checkpoint('concatenating items');
                yield readArrayItem(source, index);
            }
        }
    }
}

/** Join equal-rank arrays on an existing axis. Rank-one sequences retain their plans. */
export function concatValues(values: readonly RankValue[], axis = 0): RankArray | RankSequence {
    const mismatch = (message: string) => new RankError(message, 'DimensionMismatch');
    if (!Number.isSafeInteger(axis) || axis < 0) throw mismatch('concat axis must be a nonnegative integer');
    if (values.length === 0) {
        if (axis !== 0) throw mismatch(`concat axis ${axis} exceeds input rank 1`);
        return ownedArray([], [0]);
    }
    if (values.some(value => !isRankArray(value) && !isRankSequence(value))) {
        throw new RankError('concat items must all be arrays or sequences', 'TypeError');
    }
    const hasSequence = values.some(isRankSequence);
    const arrays = values.filter(isRankArray);
    const rank = arrays[0]?.shape.length ?? 1;
    if (rank === 0 || axis >= rank) throw mismatch(`concat axis ${axis} exceeds input rank ${rank}`);
    if (hasSequence) {
        if (rank !== 1 || axis !== 0 || arrays.some(array => array.shape.length !== 1)) {
            throw mismatch('concat sequences require rank-one inputs and axis 0');
        }
        const sources = values as readonly (RankArray | RankSequence)[];
        let exact = 0n;
        let unknown = false;
        let infinite = false;
        for (const source of sources) {
            const size = isRankSequence(source) ? source.plan.size : { kind: 'exact' as const, value: BigInt(source.shape[0]) };
            if (size.kind === 'exact') exact += size.value;
            else if (size.kind === 'infinite') infinite = true;
            else unknown = true;
        }
        const result = sequence({
            name: 'concat',
            size: infinite ? { kind: 'infinite' } : unknown ? { kind: 'unknown' } : { kind: 'exact', value: exact },
            singlePass: sources.some(source => isRankSequence(source) && source.plan.singlePass),
            iterate: () => concatItems(sources),
        });
        concatPlans.set(result.plan, { sources, iterate: result.plan.iterate });
        return result;
    }
    const shape = [...arrays[0]!.shape];
    let total = 0;
    for (const source of arrays) {
        checkpoint('concatenating items');
        if (source.shape.length !== rank || source.shape.some((length, index) =>
            index !== axis && length !== shape[index])) throw mismatch('concat items must match on non-concatenated axes');
        total += source.shape[axis];
        if (!Number.isSafeInteger(total)) throw mismatch('concat axis is too long');
    }
    shape[axis] = total;
    return concatArrays(arrays, shape, axis);
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

    return permutedArray(value, permutation);
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
    const source = collectionSize(value);
    if (source?.axisLength) return source.axisLength(axis);
    if (axis !== 0) throw new RankError(`value has no axis ${axis}`);
    throw new RankError('len axis expects text, an array, queue, multiset or sequence');
}

function shapeOf(value: RankValue): RankValue {
    const dimensions = collectionSize(value, 'shape')?.axes?.();
    if (!dimensions) throw new RankError('shape expects text, an array, queue, multiset or sequence');
    return ownedArray([...dimensions]);
}

function arrayItems(value: RankArray): RankValue[] {
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    return Array.from({ length: size }, (_, index) => readArrayItem(value, index));
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

export function reshapeWithDimensions(value: RankValue, dimensions: readonly (RankValue | undefined)[]): RankValue {
    const type = isRankArray(value) && !value.columnNames ? semanticArrayType(value) : undefined;
    let collected: RankValue[] | undefined;
    const shape = reshapeDimensions(dimensions, () => {
        // A generator is consumed once, and tensor counts include every axis.
        return isRankArray(value) ? value.shape.reduce((total, size) => total * BigInt(size), 1n)
            : BigInt((collected = reshapeItems(value)).length);
    });
    const expected = dimensions.includes(undefined)
        ? Number(shape.reduce((product, dimension) => product * BigInt(dimension), 1n))
        : shape.reduce((product, dimension) => product * dimension, 1);
    // Stored scalar cells keep their order; only shape metadata changes.
    const stored = isRankArray(value) ? denseScalarItems(value) : undefined;
    if (stored && stored.length === expected) {
        const result = reshapeStoredArray(value as RankArray, shape);
        if (result) return type ? setSemanticArrayType(result, type) : result;
    }
    const items = collected ?? reshapeItems(value);
    if (items.length !== expected) {
        throw new RankError(
            `reshape shape ${shape.join(' ')} expects ${expected} elements, got ${items.length}`,
        );
    }
    const result = ownedArray(items, shape);
    return type ? setSemanticArrayType(result, type) : result;
}

export function reshapeWithShapeRows(value: RankValue, shapes: RankArray): RankArray {
    return stackValues(Array.from({ length: shapes.shape[0] }, (_, index) => {
        const row = atArray(shapes, [BigInt(index)]);
        if (!isRankArray(row) || row.shape.length !== 1) {
            throw new RankError('reshape shape rows must be rank-1 integer arrays');
        }
        return reshapeWithDimensions(value, Array.from({ length: row.shape[0] }, (_, column) =>
            readArrayItem(row, column)));
    }));
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
    const source = collectionSize(value);
    if (!source) throw new RankError('len expects text or a collection');
    return source.length();
}

function fibonacciPlan(
    boundary?: Boundary,
    evenOnly = false,
    lower?: Boundary,
): SequencePlan {
    const plan: SequencePlan = {
        name: evenOnly ? 'even fibonacci' : 'fibonacci',
        replay: 'pure',
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
            return fibonacciPlan(strongerUpper(boundary, { limit, inclusive }), evenOnly, lower);
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
    registerSequenceMembership(plan);
    return plan;
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

/** The direction after an ordering operation: `.ascending` or `.descending`. */
export function sortDescending(direction: RankValue, operation = 'sort'): boolean {
    if (!isRankLabel(direction) || (direction.name !== 'ascending' && direction.name !== 'descending')) {
        throw new RankError(`${operation} direction must be .ascending or .descending`, 'TypeError');
    }
    return direction.name === 'descending';
}

/** What `sort` returns besides the ordered values: the permutation, or both. */
export type SortMode = 'indexes' | 'indexed';

/** `.indexes` (or `.index`) and `.indexed` after sort; any other label is a direction. */
export function sortMode(label: RankValue): SortMode | undefined {
    if (!isRankLabel(label)) return undefined;
    if (label.name === 'indexes' || label.name === 'index') return 'indexes';
    return label.name === 'indexed' ? 'indexed' : undefined;
}

/** The standard sort or argsort fixed to one direction and result, keeping its ranks. */
export function directedSort(
    fn: NativeFunction, name: 'sort' | 'argsort', descending: boolean, mode?: SortMode,
): NativeFunction {
    if (name === 'argsort') return { ...fn, call: args => argsortValue(args[0], descending) };
    if (mode === 'indexes') return { ...fn, call: args => argsortValue(args[0], descending) };
    if (mode === 'indexed') {
        return { ...fn, call: args => {
            const fast = numericSort(args[0], descending, 'indexed');
            return fast ? tuple([fast.values!, fast.indexes!])
                : tuple([sortValue(args[0], descending), argsortValue(args[0], descending)]);
        } };
    }
    return { ...fn, call: args => sortValue(args[0], descending) };
}

/**
 * `Flat I = Record` or `Flat I .field op= Value`: the index and field are
 * checked, and the record read, before the value is evaluated.
 */
export function flatRecordWrite(
    target: FlatRecords, selectors: readonly RankValue[], operator: string, operators: Operators,
): (value: RankValue) => RankValue {
    if (selectors.length < 1 || selectors.length > 2 || typeof selectors[0] !== 'bigint') {
        throw new RankError('flat assignment expects an integer index and optional field');
    }
    const index = Number(selectors[0]);
    const previous = target.itemAt(index);
    return value => {
        if (selectors.length === 2) {
            const field = selectors[1];
            if (!isRankLabel(field)) throw new RankError('flat assignment expects a field label');
            const result = assignRecordField(previous, field.name, operator, value, operators);
            target.set(index, previous);
            return result;
        }
        if (operator !== '=') throw new RankError('flat record assignment supports =');
        const result = materializeValue(value);
        target.set(index, result);
        return result;
    };
}

/**
 * Postfix `array` over a container whose `for` order is defined: a copy of
 * its items in that order, leaving the container as it was. Undefined for
 * any other value.
 */
export function materializeCollection(value: RankValue): RankArray | undefined {
    if (!(value instanceof RankDeque || isRankQueue(value) || isRankSet(value) || isRankMultiset(value))) return undefined;
    const items = value instanceof RankDeque || value instanceof RankHeap ? value.values()
        : isRankQueue(value) ? value.items
            : isRankSet(value) ? value.entries.values()
                : value.values();
    return stackItems(items, undefined, 'collection');
}
