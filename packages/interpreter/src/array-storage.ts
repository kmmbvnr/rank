import { interruptibleCallback } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import { ResourceSummary } from './resource-summary.js';
import { MissingValueError, RankError } from './errors.js';
import { isRankArray, type RankArray, type RankObject, type RankValue } from './value.js';

/** Eager numeric cells only. Lazy Rank readers must retain their caches. */
export function eagerArrayStorage(value: RankValue): {
    shape: readonly number[]; read: (index: number) => RankValue;
} | undefined {
    const owned = typeof value === 'object' ? ownedStorage.get(value as RankArray) : undefined;
    if (!owned && (!isRankArray(value) || 'itemAt' in value)) return undefined;
    if (owned && !owned.stable) return undefined;
    const items = owned?.items ?? Object.getOwnPropertyDescriptor(value, 'items')?.value;
    if (!Array.isArray(items)
        || !items.every(item => typeof item === 'number' || typeof item === 'bigint' || typeof item === 'boolean')) {
        return undefined;
    }
    return { shape: owned?.shape ?? (value as RankArray).shape, read: index => items[index] };
}

/** A shallow copy for our JS callers, not an immutability or isolation boundary. */
export function createArraySnapshot(items: Iterable<RankValue>, shape?: readonly number[]): RankArray {
    const copied = Array.from(items);
    const dimensions = shape === undefined ? [copied.length] : [...shape];
    if (dimensions.some(size => !Number.isSafeInteger(size) || size < 0)
        || dimensions.reduce((size, dimension) => size * BigInt(dimension), 1n) !== BigInt(copied.length)) {
        throw new RankError('array snapshot shape does not match its items', 'DimensionMismatch');
    }
    return ownedArray(copied, dimensions);
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
    if (owned) return owned.stable ? owned.items : undefined;
    if ('itemAt' in value) return cachedStorage.get(value)?.();
    const items = Object.getOwnPropertyDescriptor(value, 'items')?.value;
    return Array.isArray(items) ? items : undefined;
}


interface OwnedStorage {
    items: RankValue[];
    shape: readonly number[];
    revision: number;
    birth: number;
    scalarOnly: boolean;
    stable: boolean;
    resources: ResourceSummary;
    nestedEpoch?: number;
    checkedBirth?: number;
    nestedRevision?: number;
}
let writeRevision = 0;
let creationSerial = 0;
const mutationBirths = new Float64Array(1024);

function noteMutation(birth: number): number {
    mutationBirths[++writeRevision % mutationBirths.length] = birth;
    return writeRevision;
}

// Old expressions cannot depend on objects created after their last full
// validation, unless an older parent was changed to reference those objects.
// Keep a bounded write journal; missing history simply triggers a full check.
function onlyNewObjectsChanged(epoch: number, checkedBirth: number): boolean {
    if (epoch < 0 || writeRevision - epoch > mutationBirths.length) return false;
    for (let entry = epoch + 1; entry <= writeRevision; entry++) {
        if (mutationBirths[entry % mutationBirths.length] <= checkedBirth) return false;
    }
    return true;
}
const ownedStorage = new WeakMap<RankArray, OwnedStorage>();

/** Takes exclusive ownership of fresh storage. JS sees a write-tracked facade;
 * internal read kernels may borrow the raw storage without proxy overhead. */
export function ownedArray(
    items: RankValue[], shape: readonly number[] = [items.length], scalarOnly = false,
    columnNames?: readonly string[],
): RankArray {
    const state: OwnedStorage = {
        items, shape: [...shape], revision: writeRevision, birth: ++creationSerial, scalarOnly: scalarOnly || items.every(item => typeof item !== 'object'),
        stable: true, resources: undefined!,
    };
    state.resources = new ResourceSummary(() => state.scalarOnly && state.stable);
    if (!state.scalarOnly) for (const item of items) state.resources.include(item);
    const changed = (value: RankValue) => {
        state.revision = noteMutation(state.birth);
        state.resources.include(value);
        state.scalarOnly &&= typeof value !== 'object';
    };
    const uncertain = () => {
        state.revision = noteMutation(state.birth);
        state.resources.invalidate();
        state.scalarOnly = false;
        state.stable = false;
    };
    const facade = new Proxy(items, {
        set(target, key, value) {
            const success = Reflect.set(target, key, value, target);
            if (success) changed(value);
            return success;
        },
        defineProperty(target, key, descriptor) {
            const success = Reflect.defineProperty(target, key, descriptor);
            if (success) {
                if ('get' in descriptor || 'set' in descriptor) uncertain();
                else if ('value' in descriptor) changed(descriptor.value);
                else state.revision = noteMutation(state.birth);
            }
            return success;
        },
        deleteProperty(target, key) {
            const success = Reflect.deleteProperty(target, key);
            if (success) state.revision = noteMutation(state.birth);
            return success;
        },
        setPrototypeOf(target, prototype) {
            const success = Reflect.setPrototypeOf(target, prototype);
            if (success) uncertain();
            return success;
        },
    });
    const value: RankArray = new Proxy({ kind: 'array' as const, items: facade, shape: Object.freeze([...shape]),
        ...(columnNames === undefined ? {} : { columnNames: Object.freeze([...columnNames]) }) }, {
        set(target, key, replacement) {
            const success = Reflect.set(target, key, replacement, target);
            if (success) uncertain();
            return success;
        },
        defineProperty(target, key, descriptor) {
            const success = Reflect.defineProperty(target, key, descriptor);
            if (success) uncertain();
            return success;
        },
        deleteProperty(target, key) {
            const success = Reflect.deleteProperty(target, key);
            if (success) uncertain();
            return success;
        },
        setPrototypeOf(target, prototype) {
            const success = Reflect.setPrototypeOf(target, prototype);
            if (success) uncertain();
            return success;
        },
    });
    ownedStorage.set(value, state);
    return state.resources.track(value);
}

/** Unknown host storage has no reliable revision and must not retain derived caches. */
export function arrayRevision(value: RankArray): number | undefined {
    return valueRevision(value);
}

const revisiting = new WeakSet<object>();
function valueRevision(value: RankValue): number | undefined {
    if (typeof value !== 'object') return 0;
    if (revisiting.has(value)) return undefined;
    const derived = derivedRevisions.get(value);
    if (derived) {
        if (derived.epoch !== writeRevision) {
            if (onlyNewObjectsChanged(derived.epoch, derived.checkedBirth ?? 0)) {
                derived.epoch = writeRevision;
                return derived.cached;
            }
            revisiting.add(value);
            try { derived.cached = derived.revision(); }
            finally { revisiting.delete(value); }
            derived.epoch = writeRevision;
            derived.checkedBirth = creationSerial;
        }
        return derived.cached;
    }
    const state = ownedStorage.get(value as RankArray);
    if (!state?.stable) return undefined;
    if (state.scalarOnly) return state.revision;
    // Nested mutable arrays and object rows are dependencies as well.
    if (state.nestedEpoch === writeRevision) return state.nestedRevision;
    if (state.nestedEpoch !== undefined
        && onlyNewObjectsChanged(state.nestedEpoch, state.checkedBirth ?? 0)) {
        state.nestedEpoch = writeRevision;
        return state.nestedRevision;
    }
    revisiting.add(value);
    try { state.nestedRevision = containedRevision(state.items, state.revision); }
    finally { revisiting.delete(value); }
    state.nestedEpoch = writeRevision;
    state.checkedBirth = creationSerial;
    return state.nestedRevision;
}

function containedRevision(values: Iterable<RankValue>, own: number): number | undefined {
    for (const value of values) {
        const next = valueRevision(value);
        if (next === undefined) return undefined;
        own = Math.max(own, next);
    }
    return own;
}


// A DAG can reference the same derived source repeatedly (matrix squaring).
// Validate each node once per write epoch, rather than expanding every path.
const derivedRevisions = new WeakMap<object, {
    revision: () => number | undefined; epoch: number; cached?: number; checkedBirth?: number;
}>();

/** Cache a pure reader only while all its explicit dependencies have known revisions.
 * Untracked host buffers remain live: retained aliases can mutate outside Rank.
 * Registering the dependency revision also invalidates downstream expressions.
 */
export function derivedArray(
    shape: readonly number[], dependencies: readonly RankArray[],
    read: (index: number) => RankValue, fileFree = false,
): RankArray {
    const diagnostics = currentDiagnostics();
    const revision = () => {
        let current = 0;
        for (const source of dependencies) {
            const next = arrayRevision(source);
            if (next === undefined) return undefined;
            current = Math.max(current, next);
        }
        return current;
    };
    let seen: number | undefined;
    let validatedEpoch = -1;
    const cells = new Map<number, RankValue>();
    let materialized: RankValue[] | undefined;
    let compilerCache: RankValue[] | undefined;
    const valid = () => {
        if (diagnostics) diagnostics.validationRequests++;
        // No writes means the previous dependency proof still holds. Keep this
        // local: tensor kernels read many cells in the same write epoch.
        if (validatedEpoch === writeRevision) return seen !== undefined;
        if (diagnostics) diagnostics.dependencyValidations++;
        const current = arrayRevision(value);
        validatedEpoch = writeRevision;
        if (current === undefined || current !== seen) {
            if (diagnostics && seen !== undefined) diagnostics.invalidations++;
            cells.clear();
            materialized = undefined;
            compilerCache = undefined;
            seen = current;
        }
        return current !== undefined;
    };
    const itemAt = (index: number): RankValue => {
        const cacheable = valid();
        if (cacheable && cells.has(index)) {
            if (diagnostics) diagnostics.cacheHits++;
            return cells.get(index)!;
        }
        const started = seen;
        const startedEpoch = writeRevision;
        if (diagnostics) diagnostics.cacheMisses++;
        const result = read(index);
        if (diagnostics) diagnostics.cellsComputed++;
        // A dependency may have changed during the reader. Never retain that read.
        if (cacheable && (writeRevision === startedEpoch || arrayRevision(value) === started)) cells.set(index, result);
        return result;
    };
    const value: RankArray = {
        kind: 'array', shape, itemAt,
        containsFiles: fileFree ? false : undefined,
        get items() {
            const cacheable = valid();
            if (materialized) return materialized;
            const started = seen;
            const items = Array.from(
                { length: shape.reduce((size, dimension) => size * dimension, 1) },
                interruptibleCallback((_: unknown, index: number) => itemAt(index), 'materializing array'),
            );
            if (cacheable && arrayRevision(value) === started) materialized = items;
            return items;
        },
    };
    derivedRevisions.set(value, { revision, epoch: -1 });
    return registerCachedArray(value, () => {
        if (!valid()) return undefined;
        if (compilerCache) return compilerCache;
        const size = shape.reduce((product, dimension) => product * dimension, 1);
        if (cells.size !== size) return undefined;
        for (let index = 0; index < size; index++) if (!cells.has(index)) return undefined;
        return compilerCache = Array.from({ length: size }, (_, index) => cells.get(index)!);
    });
}


// Borrowed access is confined to compiled regions without user callbacks. The
// public Rank value keeps its identity; only generated reads/writes use this view.
const borrowedStorage = new WeakMap<RankArray, OwnedStorage>();
export function borrowArrayStorage(value: RankValue | undefined): RankValue | undefined {
    if (!value || !isRankArray(value)) return value;
    const state = ownedStorage.get(value);
    if (!state?.stable) return value;
    const view: RankArray = { kind: 'array', shape: [...value.shape], items: state.items };
    borrowedStorage.set(view, state);
    return view;
}

/** Prepare once per compiled region; avoid a WeakMap lookup on each write. */
export function prepareScalarArrayWriter(value: RankValue | undefined, batch = false): (index: number, item: bigint | boolean) => void {
    const array = value as RankArray;
    const state = array && borrowedStorage.get(array);
    if (!state) return (index, item) => { array.items[index] = item; };
    const items = state.items;
    let changed = false;
    return (index, item) => {
        // Batching is allowed only in a compiler-proved region with no lazy
        // reads or callbacks. Publish before its first write, including errors.
        if (!batch || !changed) {
            state.revision = noteMutation(state.birth);
            changed = true;
        }
        items[index] = item;
    };
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
    const items = state?.items ?? cached!, shape = array.shape;
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
        return items[offset];
    };
}


class OwnedEntries extends Map<string, RankValue> {
    revision = writeRevision;
    readonly birth = ++creationSerial;
    readonly resources = new ResourceSummary();

    constructor(entries: Iterable<readonly [string, RankValue]>) {
        super();
        for (const [key, value] of entries) {
            this.resources.include(value);
            Map.prototype.set.call(this, key, value);
        }
    }

    override set(key: string, value: RankValue): this {
        this.resources.include(value);
        this.revision = noteMutation(this.birth);
        return super.set(key, value);
    }
    override delete(key: string): boolean {
        const removed = super.delete(key);
        if (removed) this.revision = noteMutation(this.birth);
        return removed;
    }
    override clear(): void {
        if (this.size) this.revision = noteMutation(this.birth);
        super.clear();
    }
}

/** Own a JSON/table object's entry map so field writes invalidate projections. */
export function ownedObject(entries: Iterable<readonly [string, RankValue]>): RankObject {
    const map = new OwnedEntries(entries);
    // Entry mutation is public; replacing the map would bypass its revision.
    const object: RankObject = Object.freeze({ kind: 'object', entries: map });
    derivedRevisions.set(object, {
        epoch: -1, revision: () => containedRevision(map.values(), map.revision),
    });
    return map.resources.track(object);
}

/** Publish dependencies for a pure producer with a dynamically inferred shape. */
export function registerArrayDependencies<T extends RankArray>(value: T, sources: readonly RankArray[]): T {
    derivedRevisions.set(value, { epoch: -1, revision: () => containedRevision(sources, 0) });
    return value;
}


/** Runtime-owned storage has no observable getters; host readers keep their order. */
export function readArrayItem(value: RankArray, index: number): RankValue {
    const state = ownedStorage.get(value);
    if (state?.stable) return state.items[index];
    return value.itemAt?.(index) ?? value.items[index];
}

export function readArrayShape(value: RankArray): readonly number[] {
    const state = ownedStorage.get(value);
    return state?.stable ? state.shape : value.shape;
}
