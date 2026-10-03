import { interruptibleCallback } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import { ResourceSummary } from './resource-summary.js';
import { MissingValueError, RankError } from './errors.js';
import { isRankArray, typeName, requireHomogeneous, MISSING, type RankArray, type RankObject, type RankValue } from './value.js';

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
    if (owned) {
        owned.convert?.();
        return owned.stable ? owned.items : undefined;
    }
    if ('itemAt' in value) return cachedStorage.get(value)?.();
    const items = Object.getOwnPropertyDescriptor(value, 'items')?.value;
    return Array.isArray(items) ? items : undefined;
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


interface OwnedStorage {
    /** The cells. Typed storage stands in here while `typed` is set: only index
     * and length reads are valid on it, and `convert` swaps in a plain array. */
    items: RankValue[];
    typed?: Float64Array | BigInt64Array;
    /** Bit i set means cell i of `typed` has a value; absent when every cell has one.
     * The buffer holds 0 in a cell without a value. A masked array is not
     * `scalarOnly`: kernels that do not read the bits must not see its buffer. */
    validity?: Uint32Array;
    convert?: () => void;
    /** The revision at which every cell was last found to be a number, or not. */
    realChecked?: { revision: number; real: boolean };
    shape: readonly number[];
    revision: number;
    birth: number;
    scalarOnly: boolean;
    stable: boolean;
    resources: ResourceSummary;
    owners?: number;
    nestedEpoch?: number;
    checkedBirth?: number;
    nestedRevision?: number;
}
let writeRevision = 0;
let creationSerial = 0;

// A buffer we cannot track changes only while the host holds control: a JS
// caller writing its own array is not running Rank at that moment. A reader
// over one may therefore keep its cells for one stretch of work we were asked
// to do, and reads live again as soon as control could have left us. Without
// that, a reader standing on a reader recomputes the chain below it for every
// cell, and a loop whose step reads the step before it twice — gradient
// descent — costs an exponent in its number of steps.
let runtimeDepth = 0;
let hostEntry = 0;

/** Opens a stretch of work the host asked for. Nested calls extend the one
 * already open; only the outermost hands control back. */
export function enterRuntime(): void { runtimeDepth += 1; }
export function leaveRuntime(): void { if ((runtimeDepth -= 1) === 0) hostEntry += 1; }

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

/**
 * The cells of a lazy array read all at once. A cell that has no data (a soft
 * miss) reads as `.NA` here, so a whole array holds its gaps as values and the vector paths
 * never need an exception; reading one cell by itself still raises `.Missing`.
 */
export function materializeCells(size: number, read: (index: number) => RankValue): RankValue[] {
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

/** Cheap borrow guard: no lazy cells or nested values can escape through indexing. */
export function isFlatScalarArray(value: RankValue): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const storage = ownedStorage.get(value as RankArray);
    return !!storage?.stable && storage.scalarOnly && storage.shape.length === 1;
}

/** The stored cells of an array whose every cell is already a scalar and which
 * nothing can change under us: reading them cannot run lazy work or raise. */
export function denseScalarItems(value: RankArray): ArrayLike<RankValue> | undefined {
    const storage = ownedStorage.get(value);
    return storage?.stable && storage.scalarOnly ? storage.items : undefined;
}

/**
 * The cells of an array when every one is a real number: a real typed buffer,
 * or stored cells checked once per revision. Real arithmetic on such cells
 * needs no type dispatch and can write straight into a typed buffer.
 */
export function realCells(value: RankArray): ArrayLike<number> | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.scalarOnly) return undefined;
    if (state.typed) return state.typed instanceof Float64Array ? state.typed : undefined;
    if (state.realChecked?.revision !== state.revision) {
        let real = true;
        for (let index = 0; index < state.items.length; index += 1) {
            if (typeof state.items[index] !== 'number') { real = false; break; }
        }
        state.realChecked = { revision: state.revision, real };
    }
    return state.realChecked.real ? state.items as unknown as number[] : undefined;
}

/** The real cells of an array as one Float64Array, or undefined if any cell is
 * not a real number. A typed buffer is shared; plain cells are copied. */
export function float64Cells(value: RankArray): Float64Array | undefined {
    const state = ownedStorage.get(value);
    if (state?.stable && state.typed instanceof Float64Array && !state.validity) return state.typed;
    const plain = realCells(value);
    if (!plain) return undefined;
    // A plain loop: `Float64Array.from` walks an iterator, several times slower.
    const copy = new Float64Array(plain.length);
    for (let index = 0; index < plain.length; index += 1) copy[index] = plain[index];
    return copy;
}

/** Cells already stored, with no lazy reads or host cell getter calls. */
export function storedOperandItems(value: RankArray): ArrayLike<RankValue> | undefined {
    if (ownedStorage.get(value)?.validity) return undefined;
    const dense = denseScalarItems(value);
    if (dense) return dense;
    const items = materializedArrayItems(value);
    if (!items) return undefined;
    for (let index = 0; index < items.length; index++) {
        const property = Object.getOwnPropertyDescriptor(items, index);
        if (!property || !('value' in property)) return undefined;
        const type = typeof property.value;
        if (type !== 'number' && type !== 'bigint' && type !== 'boolean') return undefined;
    }
    return items;
}

const SMALL_OPERAND_CELLS = 4096;
const MAX_EAGER_OPERAND_CELLS = 1 << 25;

/**
 * The scalar cells of an operand for an eager kernel: the stored cells of a
 * dense array, or the values of a small lazy one, which costs little next to a
 * large partner. Declines when reading raises (the lazy path raises it when
 * the cell is demanded) or when a cell is not a number.
 */
export function eagerOperandItems(value: RankArray): ArrayLike<RankValue> | undefined {
    // Reading the cells of a masked array would turn it into a plain one.
    if (ownedStorage.get(value)?.validity) return undefined;
    const stored = denseScalarItems(value);
    if (stored) return stored;
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    if (size > MAX_EAGER_OPERAND_CELLS) return undefined;
    if (size > SMALL_OPERAND_CELLS) {
        // A large lazy operand is read once and kept: the result is dense anyway,
        // and leaving the layer lazy makes every later read walk the whole chain.
        // A host buffer has no revision, so its reads stay in the host's order.
        if (arrayRevision(value) === undefined) return undefined;
        try {
            const items = value.items;
            for (let index = 0; index < size; index += 1) {
                const cell = items[index];
                if (typeof cell !== 'number' && typeof cell !== 'bigint') return undefined;
            }
            return items;
        } catch (error) {
            if (error instanceof RankError) return undefined;
            throw error;
        }
    }
    const cells: RankValue[] = new Array(size);
    try {
        for (let index = 0; index < size; index += 1) {
            const cell = readArrayItem(value, index);
            if (typeof cell !== 'number' && typeof cell !== 'bigint') return undefined;
            cells[index] = cell;
        }
    } catch (error) {
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return cells;
}

/** Takes exclusive ownership of fresh storage. JS sees a write-tracked facade;
 * internal read kernels may borrow the raw storage without proxy overhead. */
export function ownedArray(
    items: RankValue[], shape: readonly number[] = [items.length], scalarOnly = false,
    columnNames?: readonly string[],
): RankArray {
    if (!columnNames) {
        const kinds = new Map<string, { type: string; rank?: number }>();
        for (const item of items) {
            const type = typeof item === 'number' && !Number.isFinite(item) && !Number.isNaN(item)
                ? 'numeric-limit' : typeName(item);
            const rank = isRankArray(item) ? item.shape.length : undefined;
            kinds.set(`${type}:${rank}`, { type, ...(rank === undefined ? {} : { rank }) });
        }
        requireHomogeneous([...kinds.values()]);
    }
    return createOwned(items, shape, scalarOnly, columnNames);
}

/**
 * An array of integers or of reals held in one typed buffer, 8 bytes a cell
 * where boxed cells cost several times that. Kernels read the cells in place.
 * Anything that needs a plain array of cells (public `items`, a write, a
 * compiled region) converts once, and the array is an ordinary owned one from
 * then on. Takes ownership of `data`.
 */
export function typedArray(
    data: Float64Array | BigInt64Array, shape: readonly number[] = [data.length],
    columnNames?: readonly string[],
): RankArray {
    return createOwned(data, shape, true, columnNames);
}

/** The element type of an array still held in a typed buffer. */
export function typedElementKind(value: RankArray): 'integer' | 'real' | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.typed || state.validity) return undefined;
    return state.typed instanceof BigInt64Array ? 'integer' : 'real';
}

/**
 * A real or integer array whose cells may have no value: the values buffer
 * plus a validity bitmap, one bit a cell with a set bit meaning a value is
 * present (the Arrow layout). A cell without a value holds 0 in the buffer.
 * Takes ownership of both. Kernels that know about the bitmap read it through
 * `maskedCells`; everything else sees `.NA` cells in the plain view.
 */
export function maskedArray(
    values: Float64Array | BigInt64Array, validity: Uint32Array, shape: readonly number[] = [values.length],
): RankArray {
    return createOwned(values, shape, false, undefined, validity);
}

/** The buffer and bitmap of a real masked array, or undefined for any other array. */
export function maskedCells(value: RankArray): { values: Float64Array; validity: Uint32Array } | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.validity || !(state.typed instanceof Float64Array)) return undefined;
    return { values: state.typed, validity: state.validity };
}

export function hasMaskedCells(value: RankArray): boolean {
    return ownedStorage.get(value)?.validity !== undefined;
}

/** Number of 32-bit words holding a bitmap for this many cells. */
export function validityWords(size: number): number { return (size + 31) >>> 5; }

/** A bitmap with the first `size` cells present. */
export function allPresent(size: number): Uint32Array {
    const bits = new Uint32Array(validityWords(size)).fill(0xFFFFFFFF);
    if (size & 31) bits[bits.length - 1] = (1 << (size & 31)) - 1;
    return bits;
}

export function isPresentAt(validity: Uint32Array, index: number): boolean {
    return (validity[index >>> 5] >>> (index & 31) & 1) === 1;
}

/** Whether every one of the first `size` cells has a value. */
export function allValid(validity: Uint32Array, size: number): boolean {
    const whole = size >>> 5;
    for (let word = 0; word < whole; word += 1) if (validity[word] !== 0xFFFFFFFF) return false;
    if (!(size & 31)) return true;
    const tail = ((1 << (size & 31)) - 1) >>> 0;
    return ((validity[whole] & tail) >>> 0) === tail;
}

/**
 * 'scalar' for cells that are all numbers (nothing to do), the buffer and
 * bitmap when the cells are numbers of one kind and `.NA`, otherwise undefined.
 * Stops at the first cell of any other kind, so ordinary arrays cost a short scan.
 */
function scanForMissing(items: readonly RankValue[]): 'scalar' | { values: Float64Array | BigInt64Array; validity: Uint32Array } | undefined {
    let kind = 0;
    let missing = false;
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item === MISSING) { missing = true; continue; }
        const type = typeof item === 'number' ? 1 : typeof item === 'bigint' ? 2 : 0;
        if (type === 0 || (kind !== 0 && type !== kind)) return undefined;
        kind = type;
    }
    if (!missing) return kind === 0 ? undefined : 'scalar';
    const validity = new Uint32Array(validityWords(items.length));
    const values = kind === 2 ? new BigInt64Array(items.length) : new Float64Array(items.length);
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item === MISSING) continue;
        (values as unknown as RankValue[])[index] = item;
        validity[index >>> 5] |= 1 << (index & 31);
    }
    return { values, validity };
}

function createOwned(
    cells: RankValue[] | Float64Array | BigInt64Array, shape: readonly number[], scalarOnly: boolean,
    columnNames?: readonly string[], validity?: Uint32Array,
): RankArray {
    const typed = Array.isArray(cells) ? undefined : cells;
    const items = cells as RankValue[];
    if (!typed && !scalarOnly) {
        // Cells with no value are kept beside a numeric buffer, not in it.
        const found = scanForMissing(items);
        if (found === 'scalar') scalarOnly = true;
        else if (found) return createOwned(found.values, shape, false, columnNames, found.validity);
    }
    const state: OwnedStorage = {
        items, typed, validity, shape: [...shape], revision: writeRevision, birth: ++creationSerial,
        scalarOnly: !validity && (typed !== undefined || scalarOnly || items.every(item => typeof item !== 'object')),
        stable: true, resources: undefined!,
    };
    state.resources = new ResourceSummary(() => state.scalarOnly && state.stable);
    if (!state.scalarOnly && !typed) for (const item of items) state.resources.include(item);
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
    const facadeOf = (target: RankValue[]) => new Proxy(target, {
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
    const raw = { kind: 'array' as const, items: undefined as unknown as RankValue[], shape: Object.freeze([...shape]),
        ...(columnNames === undefined ? {} : { columnNames: Object.freeze([...columnNames]) }) };
    if (typed) {
        Object.defineProperty(raw, 'items', { configurable: true, enumerable: true, get: () => { state.convert!(); return raw.items; } });
        state.convert = () => {
            const plain = Array.from(typed as ArrayLike<RankValue>);
            if (state.validity) {
                const bits = state.validity;
                for (let index = 0; index < plain.length; index += 1) {
                    if (!(bits[index >>> 5] >>> (index & 31) & 1)) plain[index] = MISSING;
                }
                state.validity = undefined;
            }
            state.items = plain;
            state.typed = undefined;
            state.convert = undefined;
            Object.defineProperty(raw, 'items', { value: facadeOf(plain), writable: true, enumerable: true, configurable: true });
        };
    } else {
        raw.items = facadeOf(items);
    }
    const value: RankArray = new Proxy(raw, {
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

// An array is a value: a name holds its own, and a write through one name is
// never visible through another. Tracking every reference would need real
// counting, so a binding records only the two states a write has to tell
// apart. A fresh expression result is unbound and is written in place; storing
// it in a second binding marks it shared, and the next write through either
// name takes a private copy first. The copy starts unbound again, so a name
// pays for sharing once rather than on every write.
const SHARED = 2;

// Storage the runtime owns and readers it built already carry a record, and a
// binding is frequent enough that a table of its own would be felt: an inner
// loop binds a row and an intermediate on every pass. Only arrays reaching us
// from a host buffer or a plain literal need one.
interface Ownership { owners?: number }
const foreignOwners = new WeakMap<RankArray, Ownership>();

function ownership(value: RankArray): Ownership | undefined {
    return ownedStorage.get(value) ?? derivedRevisions.get(value) ?? foreignOwners.get(value);
}

function ownershipFor(value: RankArray): Ownership {
    const record = ownership(value);
    if (record !== undefined) return record;
    const created: Ownership = {};
    foreignOwners.set(value, created);
    return created;
}

// A lazy reader over stored sources is a binding of those sources: once it is
// itself retained, a later write to a source must not change what it reports.
// A reader may stand on further readers, so the whole chain it reaches is
// shared. The dependency graph is a DAG that can name one source twice, so
// stop at anything already marked.
// Arrays a value keeps reading after it is made, such as the source of a mask.
const heldSources = new WeakMap<RankArray, RankArray[]>();

/** A value that reads `source` later must see it as it is now. Binding the
 * value shares the source, so a later write to it copies instead. */
export function holdArraySource(value: RankArray, source: RankArray): void {
    heldSources.set(value, [...(heldSources.get(value) ?? []), source]);
    if ((ownership(value)?.owners ?? 0) > 0) shareSources(value);
}

function shareSources(value: RankArray): void {
    for (const source of [...derivedRevisions.get(value)?.sources ?? [], ...heldSources.get(value) ?? []]) {
        const record = ownershipFor(source);
        if (record.owners === SHARED) continue;
        record.owners = SHARED;
        shareSources(source);
    }
}

/** Records that a value reached a binding: a name, parameter, field or slot. */
export function noteArrayBinding(value: RankValue): void {
    if (typeof value !== 'object' || value.kind !== 'array') return;
    const record = ownershipFor(value);
    const owners = record.owners ?? 0;
    if (owners === SHARED) return;
    shareSources(value);
    record.owners = owners + 1;
}

/** Ensures that a borrowed array has at least one binding recorded (owners = 1),
 * but does not mark it shared (owners = 2). */
export function noteArrayBorrow(value: RankValue): void {
    if (typeof value !== 'object' || value.kind !== 'array') return;
    const record = ownershipFor(value);
    if ((record.owners ?? 0) === 0) {
        shareSources(value);
        record.owners = 1;
    }
}

/** True when a write has to take a private copy before it changes a cell. */
export function isSharedArray(value: RankValue): boolean {
    return typeof value === 'object' && value.kind === 'array'
        && (ownership(value)?.owners ?? 0) >= SHARED;
}

/** Storage this name owns alone. The result is unbound: the caller binds it. */
export function privateArrayCopy(value: RankArray): RankArray {
    const stored = ownedStorage.get(value);
    if (stored?.typed) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) {
            diagnostics.cowCopies++;
            diagnostics.cowCopiedCells += stored.typed.length;
        }
        return createOwned(stored.typed.slice(), value.shape, true,
            (value as { columnNames?: readonly string[] }).columnNames, stored.validity?.slice());
    }
    const items = [...value.items];
    const diagnostics = currentDiagnostics();
    if (diagnostics) {
        diagnostics.cowCopies++;
        diagnostics.cowCopiedCells += items.length;
    }
    const copy = ownedArray(
        items, value.shape, false,
        (value as { columnNames?: readonly string[] }).columnNames,
    );
    // Both arrays now reach the same nested values, so neither owns them alone.
    for (const item of items) {
        if (typeof item === 'object' && item.kind === 'array') ownershipFor(item).owners = SHARED;
    }
    return copy;
}

/** The private storage a write goes to, copied from shared storage if needed. */
export function arrayForWrite(value: RankValue): RankArray | undefined {
    if (!isSharedArray(value)) return undefined;
    return privateArrayCopy(value as RankArray);
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
    if (state.scalarOnly || state.validity) return state.revision;
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
    // What binding this reader has to freeze; a reader over no stored array
    // has none, so only the readers that can be frozen carry the list.
    sources?: readonly RankArray[];
    owners?: number;
}>();

type DerivedRecord = NonNullable<ReturnType<typeof derivedRevisions.get>>;

const MAX_CACHED_CELLS = 1 << 24;

/** Cache a pure reader only while all its explicit dependencies have known revisions.
 * Untracked host buffers remain live: retained aliases can mutate outside Rank.
 * Registering the dependency revision also invalidates downstream expressions.
 */
export function derivedArray(
    shape: readonly number[], dependencies: readonly RankArray[],
    read: (index: number) => RankValue, fileFree = false,
): RankArray {
    const diagnostics = currentDiagnostics();
    const observedColumns = new Map<number, Map<string, { type: string; rank?: number }>>();
    const checkCell = (cell: RankValue, index: number): void => {
        const column = value.columnNames && shape.length === 2 ? index % shape[1] : 0;
        let observedKinds = observedColumns.get(column);
        if (!observedKinds) observedColumns.set(column, observedKinds = new Map());
        if (cell === MISSING) return;
        const type = typeof cell === 'number' && !Number.isFinite(cell) && !Number.isNaN(cell)
            ? 'numeric-limit' : typeName(cell);
        const rank = isRankArray(cell) ? cell.shape.length : undefined;
        const key = `${type}:${rank}`;
        if (observedKinds.has(key)) return;
        const kind = { type, ...(rank === undefined ? {} : { rank }) };
        requireHomogeneous([...observedKinds.values(), kind]);
        observedKinds.set(key, kind);
    };
    const revision = () => {
        let current = 0;
        for (const source of dependencies) {
            const next = arrayRevision(source);
            if (next === undefined) return undefined;
            current = Math.max(current, next);
        }
        return current;
    };
    const record: DerivedRecord = { revision, epoch: -1, sources: dependencies };
    let seen: number | undefined;
    let validatedEpoch = -1;
    let validatedEntry = -1;
    const cells = new Map<number, RankValue>();
    let materialized: RankValue[] | undefined;
    let compilerCache: RankValue[] | undefined;
    const valid = () => {
        if (diagnostics) diagnostics.validationRequests++;
        // No writes means the previous dependency proof still holds, and a proof
        // outlives a return to the host. A reader that has none holds only for
        // the stretch that filled its cells. Keep this local: tensor kernels
        // read many cells in the same write epoch.
        if (validatedEpoch === writeRevision
            && (seen !== undefined || validatedEntry === hostEntry)) return seen !== undefined;
        if (diagnostics) diagnostics.dependencyValidations++;
        const current = arrayRevision(value);
        validatedEpoch = writeRevision;
        validatedEntry = hostEntry;
        if (current === undefined || current !== seen) {
            if (diagnostics && seen !== undefined) diagnostics.invalidations++;
            cells.clear();
            materialized = undefined;
            compilerCache = undefined;
            seen = current;
        }
        return current !== undefined;
    };
    // Nothing observed since the read began could have changed under it: no
    // write landed, and control never left the runtime.
    const undisturbed = (epoch: number, entry: number) =>
        writeRevision === epoch && hostEntry === entry;
    const itemAt = (index: number): RankValue => {
        if (runtimeDepth === 0) {
            enterRuntime();
            try { return readCell(index); } finally { leaveRuntime(); }
        }
        return readCell(index);
    };
    const readCell = (index: number): RankValue => {
        const tracked = valid();
        if (cells.has(index)) {
            if (diagnostics) diagnostics.cacheHits++;
            return cells.get(index)!;
        }
        const started = seen;
        const startedEpoch = writeRevision;
        const startedEntry = hostEntry;
        if (diagnostics) diagnostics.cacheMisses++;
        const result = read(index);
        checkCell(result, index);
        if (diagnostics) diagnostics.cellsComputed++;
        // A dependency may have changed during the reader. Never retain that read.
        // A Map cannot hold more than 2^24 entries; a larger array recomputes
        // the cells beyond the cache rather than failing.
        if (cells.size < MAX_CACHED_CELLS && (undisturbed(startedEpoch, startedEntry)
            || (tracked && arrayRevision(value) === started))) cells.set(index, result);
        return result;
    };
    const value: RankArray = {
        kind: 'array', shape, itemAt,
        containsFiles: fileFree ? false : undefined,
        get items() {
            if (runtimeDepth === 0) {
                enterRuntime();
                try { return readAll(); } finally { leaveRuntime(); }
            }
            return readAll();
        },
    };
    function readAll(): RankValue[] {
        const tracked = valid();
        if (materialized) return materialized;
        const started = seen;
        const startedEpoch = writeRevision;
        const startedEntry = hostEntry;
        const read = interruptibleCallback((index: number) => itemAt(index), 'materializing array');
        const items = materializeCells(shape.reduce((size, dimension) => size * dimension, 1), read);
        if (undisturbed(startedEpoch, startedEntry)
            || (tracked && arrayRevision(value) === started)) materialized = items;
        return items;
    }
    derivedRevisions.set(value, record);
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
    state.convert?.();
    const view: RankArray = { kind: 'array', shape: [...value.shape], items: state.items };
    borrowedStorage.set(view, state);
    return view;
}

/** Prepare once per compiled region; avoid a WeakMap lookup on each write. */
export function prepareScalarArrayWriter(value: RankValue | undefined, batch = false): (index: number, item: bigint | boolean | string) => void {
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
    const items = state?.items ?? cached!, length = array.shape[0];
    return index => {
        if (index < 0n) throw new MissingValueError('array index out of bounds on axis 0');
        const position = Number(index);
        if (position >= length) throw new MissingValueError(`array index out of bounds on axis 0: ${index}`);
        return items[position];
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
