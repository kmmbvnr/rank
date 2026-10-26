import { ArrayCellRead } from './array-cell-read.js';
import { completed, normalizeStackError, type Evaluation, type Execution } from './execution.js';
import { checkpoint } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import { MissingValueError, RankError } from './errors.js';
import { isRankArray, MISSING, type RankArray, type RankValue } from './value.js';
import { ownedStorage, type OwnedStorage } from './array-storage-state.js';
import { arrayRevision, lazyDepth } from './array-revision.js';

/** Eager numeric cells only. Never probe a lazy reader for an optimization. */
export function eagerArrayStorage(value: RankValue): {
    shape: readonly number[]; read: (index: number) => RankValue;
} | undefined {
    const owned = typeof value === 'object' ? ownedStorage.get(value as RankArray) : undefined;
    // A host array may expose observable item getters (including through a
    // Proxy). Inspecting its cells to select a fast path would read ahead.
    if (!owned?.stable || isRankArray(value) && value.itemAt !== undefined) return undefined;
    const items = owned.items;
    if (!Array.isArray(items)
        || !items.every(item => typeof item === 'number' || typeof item === 'bigint' || typeof item === 'boolean')) {
        return undefined;
    }
    return { shape: owned.shape, read: index => items[index] };
}

/** Completed storage only; this query never evaluates a cell or a getter. */
export function materializedArrayItems(value: RankArray): RankValue[] | undefined {
    const owned = ownedStorage.get(value);
    if (owned) {
        owned.convert?.();
        return owned.stable ? owned.items : undefined;
    }
    if ('itemAt' in value) return undefined;
    const items = Object.getOwnPropertyDescriptor(value, 'items')?.value;
    return Array.isArray(items) ? items : undefined;
}

/** Stored references only. Ownership/capture scans must not call a host getter
 * or evaluate a recipe merely to discover values that it could produce later. */
export function* storedArrayValues(value: RankArray): IterableIterator<RankValue> {
    const owned = ownedStorage.get(value);
    if (owned?.stable) { yield* owned.items; return; }
    const items: unknown = Object.getOwnPropertyDescriptor(value, 'items')?.value;
    if (!Array.isArray(items)) return;
    const length: number = Object.getOwnPropertyDescriptor(items, 'length')!.value;
    for (let index = 0; index < length; index++) {
        checkpoint('inspecting stored array');
        const cell = Object.getOwnPropertyDescriptor(items, String(index))?.value as RankValue | undefined;
        if (cell !== undefined) yield cell;
    }
}

/** Copy only our completed storage: host arrays may override slice or expose
 * observable index getters, and must keep the ordinary cell-reading path. */
export function copyMaterializedArrayItems(value: RankArray, size: number): RankValue[] | undefined {
    const owned = ownedStorage.get(value);
    if (!owned?.stable || owned.typed || owned.booleans || size >= STREAM_CELLS) return undefined;
    const items = materializedArrayItems(value);
    if (items?.length !== size) return undefined;
    checkpoint('copying array', size);
    return items.slice();
}

/** Producer-cell geometry survives views even when no scalar address exists. */
export interface ArrayCells {
    /** Positions of frame axes in the tensor; omitted for leading frames. */
    readonly frameAxes?: readonly number[];
    readonly frameShape: readonly number[];
    /** Peek only: geometry becomes known when the array's shape is observed. */
    cellShape(): readonly number[] | undefined;
    /** With an observation, consume a borrowed cell before the next read in
     * that operand branch. A standalone read returns a stable cell. */
    read(index: number, observation?: ArrayCellRead): RankValue;
    /** Borrowed cells, consumed before advancing; the observer closes the cursor. */
    iterate?(): IterableIterator<RankValue>;
}
interface ArrayReadPlan {
    readonly prepare?: () => ((index: number) => RankValue) | undefined;
    readonly values?: () => IterableIterator<RankValue>;
    /** Keep a dynamic shape probe within the same full observation. */
    readonly collect?: () => RankValue[];
    readonly cells?: ArrayCells;
}

/** Logical producer cells retain meaning even when they contain no scalars. */
export function arrayCells(value: RankArray): ArrayCells | undefined {
    return arrayReadPlans.get(value)?.cells;
}
export function arrayFrameAxes(cells: ArrayCells): readonly number[] {
    return cells.frameAxes ?? cells.frameShape.map((_, axis) => axis);
}
const arrayReadPlans = new WeakMap<RankArray, ArrayReadPlan>();

export function registerArrayReadPlan<T extends RankArray>(
    value: T, plan: ArrayReadPlan,
): T {
    // Adding geometry must retain an existing checked traversal or collector.
    arrayReadPlans.set(value, { ...arrayReadPlans.get(value), ...plan });
    return value;
}

/** Preparing a reader must not read cells; using it can validate or perform effects. */
export function prepareArrayRead(value: RankArray): ((index: number) => RankValue) | undefined {
    return arrayReadPlans.get(value)?.prepare?.();
}

/** One operand cursor per traversal, with the ordinary execution-stack fallback.
 * Preparing does not demand cells; separate operands never share a cursor. */
export function prepareArrayEvaluation(value: RankArray): (index: number) => Evaluation<RankValue> {
    const read = prepareArrayRead(value);
    if (!read) return index => evaluateArrayItem(value, index);
    return index => {
        checkpoint('reading array');
        try { return completed(read(index)); }
        catch (error) { throw normalizeStackError(error); }
    };
}

/** Observe empty producer cells, owning cursors through their nested demands. */
export function* arrayCellValues(cells: ArrayCells, start = 0): IterableIterator<RankValue> {
    const observation = new ArrayCellRead();
    let failed = false;
    try {
        const size = cells.frameShape.reduce((total, n) => total * n, 1);
        for (let index = start; index < size; index++) {
            checkpoint('reading empty array cells');
            const cell = cells.read(index, observation);
            if (isRankArray(cell)) yield* arrayValues(cell);
        }
    } catch (error) { failed = true; throw error; }
    finally { observation.close(failed); }
}

/** Looking up a traversal must not start a reader or evaluate cells. */
export function arrayValueTraversal(value: RankArray): (() => IterableIterator<RankValue>) | undefined {
    return arrayReadPlans.get(value)?.values;
}

/** Each consumer owns its traversal, including its temporary buffers. */
export function* arrayValues(value: RankArray, streaming = false): IterableIterator<RankValue> {
    const traverse = arrayValueTraversal(value);
    if (traverse) { yield* traverse(); return; }
    const read = (streaming ? value.streamAt : undefined) ?? prepareArrayRead(value)
        ?? ((index: number) => readArrayItem(value, index));
    const size = value.shape.reduce((total, n) => total * n, 1);
    const cells = arrayCells(value);
    if (size === 0 && cells) {
        yield* arrayCellValues(cells);
        return;
    }
    for (let index = 0; index < size; index++) {
        checkpoint('reading array');
        let item: RankValue;
        try { item = read(index); }
        catch (error) {
            if (!(error instanceof MissingValueError) || !error.soft) throw error;
            item = MISSING;
        }
        yield item;
    }
}

/** Even a zero-element result must finish its traversal: a nonempty rank frame
 * can contain callbacks producing empty cells. Always close abandoned readers. */
export function collectArrayValues(size: number, values: IterableIterator<RankValue>): RankValue[] {
    let finished = false;
    let failed = false;
    try {
        if (size > MAX_HELD_CELLS) {
            throw new RankError(`array is too large to hold in memory: ${size} cells (at most ${MAX_HELD_CELLS})`);
        }
        const items = new Array<RankValue>(size);
        let index = 0;
        while (true) {
            const next = values.next();
            if (next.done) { finished = true; break; }
            if (index >= size) throw new RankError('array reader exceeded its declared shape', 'DimensionMismatch');
            items[index++] = next.value;
        }
        if (index !== size) throw new RankError('array reader ended before its declared shape', 'DimensionMismatch');
        return items;
    } catch (error) { failed = true; throw error; }
    finally {
        if (!finished) {
            try { values.return?.(); }
            catch (error) { if (!failed) throw error; }
        }
    }
}

export function collectArrayCells(value: RankArray): RankValue[] {
    const collect = arrayReadPlans.get(value)?.collect;
    if (collect) return collect();
    return collectArrayValues(value.shape.reduce((total, n) => total * n, 1), arrayValues(value));
}

/**
 * The cells of a lazy array read all at once. A cell that has no data (a soft
 * miss) reads as `.NA` here, so a whole array holds its gaps as values and the vector paths
 * never need an exception; reading one cell by itself still raises `.Missing`.
 */
/** The most cells one array can hold: a JavaScript array stops at 2^32 - 1 entries. */
export const MAX_HELD_CELLS = 4_294_967_295;

/** Arrays with at least this many cells are reduced one cell at a time rather than collected first. */
export const STREAM_CELLS = 1_000_000;

/** Whether a reduction should stream: the array computes its cells on demand and is big. */
export function shouldStream(value: RankArray): boolean {
    return value.itemAt !== undefined && value.shape.reduce((size, dimension) => size * dimension, 1) >= STREAM_CELLS;
}

/** The cells of an array in order, read one at a time; a cell that is softly missing reads as `.NA`. */
export function* streamCells(value: RankArray): IterableIterator<RankValue> {
    yield* arrayValues(value, true);
}

export function materializeCells(size: number, read: (index: number) => RankValue): RankValue[] {
    if (size > MAX_HELD_CELLS) {
        throw new RankError(`array is too large to hold in memory: ${size} cells (at most ${MAX_HELD_CELLS})`);
    }
    return Array.from({ length: size }, (_, index) => {
        try {
            return read(index);
        } catch (error) {
            if (error instanceof MissingValueError && error.soft) return MISSING;
            throw error;
        }
    });
}

/** One cell, with a cell that has no data (a soft miss) read as `.NA`. For whole-array
 * consumers, such as a mask, that handle `.NA` themselves. */
export function readCellOrMissing(value: RankArray, index: number): RankValue {
    try {
        return readArrayItem(value, index);
    } catch (error) {
        if (error instanceof MissingValueError && error.soft) return MISSING;
        throw error;
    }
}

// Borrowed access is confined to compiled regions without user callbacks. The
// public Rank value keeps its identity; only generated reads/writes use this view.
export const borrowedStorage = new WeakMap<RankArray, OwnedStorage>();
export function borrowArrayStorage(value: RankValue | undefined): RankValue | undefined {
    if (!value || !isRankArray(value)) return value;
    const state = ownedStorage.get(value);
    if (!state?.stable) return value;
    // Numeric buffers stay packed until a write needs boxed cells. The view
    // and its readers follow state.items when that write replaces the buffer.
    if (!state.booleans && (!state.typed || state.validity)) state.convert?.();
    const view: RankArray = { kind: 'array', shape: [...value.shape], get items() { return state.items; } };
    borrowedStorage.set(view, state);
    return view;
}

/** Both scalar and tensor readers use the same completed-storage eligibility.
 * Keep storage in an object: a writer may replace its packed cell buffer. */
function preparedReaderStorage(
    value: RankValue | undefined,
    stableReads: boolean,
): { cells: { readonly items: readonly RankValue[] }; shape: readonly number[] } | undefined {
    const array = value as RankArray;
    const owned = array && ownedStorage.get(array);
    const state = (array && borrowedStorage.get(array)) ?? (stableReads && owned?.stable && owned.booleans ? owned : undefined);
    // The caller proves no array writes, callbacks or iterators in the region.
    // Only completed, revision-tracked storage qualifies: never force cells.
    const cached = !state && stableReads && array && arrayRevision(array) !== undefined
        ? materializedArrayItems(array) : undefined;
    if (!state && !cached) return undefined;
    if (cached) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.hoistedReaders++;
    }
    return { cells: state ?? { items: cached! }, shape: array.shape };
}

function readPosition(index: bigint, size: number, axis: number): number {
    if (index < 0n) throw new MissingValueError(`array index out of bounds on axis ${axis}`);
    const position = Number(index);
    if (position >= size) throw new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`);
    return position;
}

/** Keep eager borrowed reads separate from the general reader's proxy/lazy paths. */
export function prepareArrayReader(
    value: RankValue | undefined,
    fallback: (source: RankArray, indices: readonly bigint[]) => RankValue,
    stableReads = false,
): (indices: readonly bigint[]) => RankValue {
    const storage = preparedReaderStorage(value, stableReads);
    if (!storage) return indices => fallback(value as RankArray, indices);
    const { cells, shape } = storage;
    return indices => {
        let offset = 0;
        for (let axis = 0; axis < indices.length; axis++) {
            const position = readPosition(indices[axis], shape[axis], axis);
            offset = offset * shape[axis] + position;
        }
        return cells.items[offset];
    };
}

/** One-axis compiled reads avoid allocating a selector tuple for every cell. */
export function prepareScalarArrayReader(
    value: RankValue | undefined,
    fallback: (source: RankArray, indices: readonly bigint[]) => RankValue,
    stableReads = false,
): (index: bigint) => RankValue {
    const array = value as RankArray;
    if (!value || !isRankArray(value) || array.shape.length !== 1) return index => fallback(array, [index]);
    const borrowed = borrowedStorage.get(array);
    if (borrowed?.typed instanceof Int32Array && !borrowed.validity) {
        const length = array.shape[0];
        // Avoid the Rank-facing items proxy on every compiled scalar load.
        // Follow the storage object: a later write or public exposure may widen
        // or unpack the buffer while this reader is still in use.
        return index => {
            const position = readPosition(index, length, 0);
            const typed = borrowed.typed;
            return typed instanceof Int32Array ? BigInt(typed[position]) : borrowed.items[position];
        };
    }
    // Owned storage can be read across calls without borrowing it. Follow the
    // storage record on every load: callbacks may widen, expose or invalidate
    // its cells. Foreign and lazy arrays retain the ordinary selector path.
    const owned = ownedStorage.get(array);
    if (owned?.stable) return index => {
        if (!owned.stable) return fallback(array, [index]);
        const position = readPosition(index, owned.shape[0], 0);
        if (owned.validity !== undefined && !(owned.validity[position >>> 5] >>> (position & 31) & 1)) return MISSING;
        const typed = owned.typed;
        return typed instanceof Int32Array ? BigInt(typed[position]) : owned.items[position];
    };
    const storage = preparedReaderStorage(value, stableReads);
    if (!storage) return index => fallback(array, [index]);
    const { cells, shape: [length] } = storage;
    return index => cells.items[readPosition(index, length, 0)];
}

/** Matrix addresses stay in two scalar arguments in compiled inner loops. */
export function prepareMatrixArrayReader(
    value: RankValue | undefined,
    fallback: (source: RankArray, indices: readonly bigint[]) => RankValue,
    stableReads = false,
): (row: bigint, column: bigint) => RankValue {
    const array = value as RankArray;
    const storage = preparedReaderStorage(value, stableReads);
    if (!storage || storage.shape.length !== 2) return (row, column) => fallback(array, [row, column]);
    const { cells, shape: [rows, columns] } = storage;
    return (row, column) => {
        const i = readPosition(row, rows, 0), j = readPosition(column, columns, 1);
        return cells.items[i * columns + j];
    };
}

/** Runtime-owned storage has no observable getters; host readers keep their order. */
export function readArrayItem(value: RankArray, index: number): RankValue {
    const state = ownedStorage.get(value);
    if (state?.stable) {
        if (state.validity !== undefined && !(state.validity[index >>> 5] >>> (index & 31) & 1)) return MISSING;
        return state.items[index];
    }
    return value.itemAt?.(index) ?? value.items[index];
}

export function readArrayShape(value: RankArray): readonly number[] {
    const state = ownedStorage.get(value);
    return state?.stable ? state.shape : value.shape;
}

// A child cell is suspended onto the existing execution stack. Opaque host
// readers remain synchronous; registering a plan must not inspect any cells.
const cellEvaluations = new WeakMap<RankArray, (index: number) => Execution<RankValue>>();
export function registerArrayCellEvaluation(
    value: RankArray, evaluate: (index: number) => Execution<RankValue>,
): void {
    cellEvaluations.set(value, evaluate);
}

export function evaluateArrayItem(value: RankArray, index: number): Evaluation<RankValue> {
    const evaluate = cellEvaluations.get(value);
    // Native readers already have equivalent synchronous cell access. Bound
    // its depth so shallow arithmetic avoids a generator per layer, while deep
    // dependency chains still suspend onto the execution stack.
    const depth = lazyDepth.get(value);
    if (evaluate && depth !== undefined && depth <= 128) {
        checkpoint('reading array');
        try { return completed(readArrayItem(value, index)); }
        catch (error) { throw normalizeStackError(error); }
    }
    return evaluate ? evaluate(index) : completed(readArrayItem(value, index));
}
