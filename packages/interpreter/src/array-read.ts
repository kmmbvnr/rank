import { completed, type Evaluation, type Execution } from './execution.js';
import { checkpoint } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import { MissingValueError, RankError } from './errors.js';
import { isRankArray, MISSING, type RankArray, type RankValue } from './value.js';
import { ownedStorage, type OwnedStorage } from './array-storage-state.js';
import { arrayRevision } from './array-revision.js';

/** Eager numeric cells only. Lazy Rank readers must retain their caches. */
export function eagerArrayStorage(value: RankValue): {
    shape: readonly number[]; read: (index: number) => RankValue;
} | undefined {
    const owned = typeof value === 'object' ? ownedStorage.get(value as RankArray) : undefined;
    // A host array may expose observable item getters (including through a
    // Proxy). Inspecting its cells to select a fast path would read ahead.
    if (!owned?.stable) return undefined;
    const items = owned.items;
    if (!Array.isArray(items)
        || !items.every(item => typeof item === 'number' || typeof item === 'bigint' || typeof item === 'boolean')) {
        return undefined;
    }
    return { shape: owned.shape, read: index => items[index] };
}

// Only runtime-owned readers may publish a stable, already-computed cache.
// Looking up storage must never evaluate a lazy element or call user code.
const cachedStorage = new WeakMap<RankArray, () => RankValue[] | undefined>();

export function registerCachedArray<T extends RankArray>(
    value: T, peek: () => RankValue[] | undefined,
): T {
    cachedStorage.set(value, peek);
    return value;
}

export function materializedArrayItems(value: RankArray): RankValue[] | undefined {
    const owned = ownedStorage.get(value);
    if (owned) {
        owned.convert?.();
        return owned.stable ? owned.items : undefined;
    }
    if ('itemAt' in value) return cachedStorage.get(value)?.();
    const items = Object.getOwnPropertyDescriptor(value, 'items')?.value;
    return Array.isArray(items) ? items : undefined;
}

/** Copy only our completed storage: host arrays may override slice or expose
 * observable index getters, and must keep the ordinary cell-reading path. */
export function copyMaterializedArrayItems(value: RankArray, size: number): RankValue[] | undefined {
    const owned = ownedStorage.get(value);
    if (owned?.typed || (!owned && !cachedStorage.has(value)) || size >= STREAM_CELLS) return undefined;
    const items = materializedArrayItems(value);
    if (items?.length !== size) return undefined;
    checkpoint('copying array', size);
    return items.slice();
}

/** Prepared readers remove view dispatch, not validation or effects. Preparing
 * one must not read cells; using it may still execute callbacks or throw. */
const arrayReadPlans = new WeakMap<RankArray, () => ((index: number) => RankValue) | undefined>();

export function registerArrayReadPlan<T extends RankArray>(
    value: T, prepare: () => ((index: number) => RankValue) | undefined,
): T {
    arrayReadPlans.set(value, prepare);
    return value;
}

export function prepareArrayRead(value: RankArray): ((index: number) => RankValue) | undefined {
    return arrayReadPlans.get(value)?.();
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
    const read = value.streamAt ?? value.itemAt!;
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    for (let index = 0; index < size; index += 1) {
        try {
            yield read(index);
        } catch (error) {
            if (error instanceof MissingValueError && error.soft) yield MISSING;
            else throw error;
        }
    }
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
    // An integer buffer is borrowed packed. A write that does not fit replaces
    // it with boxed cells, so the view and its readers follow state.items.
    if (!(state.typed instanceof BigInt64Array) || state.validity) state.convert?.();
    const view: RankArray = { kind: 'array', shape: [...value.shape], get items() { return state.items; } };
    borrowedStorage.set(view, state);
    return view;
}

/** Keep eager borrowed reads separate from the general reader's proxy/lazy paths. */
export function prepareArrayReader(
    value: RankValue | undefined,
    fallback: (source: RankArray, indices: readonly bigint[]) => RankValue,
    stableReads = false,
): (indices: readonly bigint[]) => RankValue {
    const array = value as RankArray;
    const state = array && borrowedStorage.get(array);
    // The caller proves no array writes, callbacks or iterators in the region.
    // Only already-computed, revision-tracked caches qualify: never force cells.
    const cached = !state && stableReads && array && arrayRevision(array) !== undefined
        ? materializedArrayItems(array) : undefined;
    if (!state && !cached) return indices => fallback(array, indices);
    if (cached) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.hoistedReaders++;
    }
    const cells = state ?? { items: cached! }, shape = array.shape;
    return indices => {
        let offset = 0;
        for (let axis = 0; axis < indices.length; axis++) {
            const index = indices[axis];
            if (index < 0n) throw new MissingValueError(`array index out of bounds on axis ${axis}`);
            const position = Number(index);
            if (position >= shape[axis]) {
                throw new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`);
            }
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
    const state = borrowedStorage.get(array);
    const cached = !state && stableReads && arrayRevision(array) !== undefined
        ? materializedArrayItems(array) : undefined;
    if (!state && !cached) return index => fallback(array, [index]);
    if (cached) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.hoistedReaders++;
    }
    const cells = state ?? { items: cached! }, length = array.shape[0];
    return index => {
        if (index < 0n) throw new MissingValueError('array index out of bounds on axis 0');
        const position = Number(index);
        if (position >= length) throw new MissingValueError(`array index out of bounds on axis 0: ${index}`);
        return cells.items[position];
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
    return evaluate ? evaluate(index) : completed(readArrayItem(value, index));
}
