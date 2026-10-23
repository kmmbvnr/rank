import { BooleanCells, booleanItems } from './boolean-cells.js';
import { checkpoint, privateLoopPolling } from './interrupt.js';
import { currentDiagnostics } from './diagnostics.js';
import { ResourceSummary } from './resource-summary.js';
import { StoredValueSummary } from './stored-value.js';
import { RankError } from './errors.js';
import { isRankArray, typeName, requireHomogeneous, MISSING, type RankArray, type RankValue } from './value.js';
import {
    ownedStorage, writeRevision, noteMutation, nextCreationSerial, SHARED, type OwnedStorage,
} from './array-storage-state.js';
import { borrowedStorage, materializedArrayItems, readArrayItem } from './array-read.js';
import { arrayRevision } from './array-revision.js';
import { scanForMissing } from './array-validity.js';

type ArrayMetadata = Pick<RankArray, 'tableScopes' | 'sortKeys'>;

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

function scalarKind(value: RankValue | undefined): string | undefined {
    switch (typeof value) {
        case 'number': return !Number.isFinite(value) && !Number.isNaN(value) ? 'numeric-limit' : 'real';
        case 'bigint': return 'integer';
        case 'boolean': return 'boolean';
        case 'string': return 'text';
        default: return undefined;
    }
}

/** Exact kinds in trusted scalar storage, without forcing a reader or declaring
 * a semantic type. Same-kind writes keep this proof valid across data revisions. */
export function storedScalarKinds(value: RankArray): readonly string[] | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.scalarOnly) return undefined;
    // An integer buffer can hold nothing else, and scanning it would box every cell.
    if (state.booleans) return state.booleans.length ? ['boolean'] : [];
    if (state.typed instanceof BigInt64Array || state.typed instanceof Int32Array) return state.typed.length ? ['integer'] : [];
    if (!state.elementKinds) {
        const kinds = new Map<string, number>();
        const diagnostics = currentDiagnostics();
        if (diagnostics) {
            diagnostics.elementTypeScans++;
            diagnostics.elementTypeScannedCells += state.items.length;
        }
        for (let index = 0; index < state.items.length; index++) {
            if ((index & 4095) === 0) checkpoint('checking scalar storage');
            const kind = scalarKind(state.items[index]);
            if (kind === undefined) return undefined;
            kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        }
        state.elementKinds = kinds;
    }
    return [...state.elementKinds.keys()].sort();
}

function updateScalarKinds(state: OwnedStorage, previous: RankValue | undefined, value: RankValue): void {
    const kinds = state.elementKinds;
    if (!kinds) return;
    const before = scalarKind(previous), after = scalarKind(value);
    if (before === undefined || after === undefined) {
        state.elementKinds = undefined;
        return;
    }
    if (before === after) return;
    const count = kinds.get(before)! - 1;
    if (count) kinds.set(before, count);
    else kinds.delete(before);
    kinds.set(after, (kinds.get(after) ?? 0) + 1);
}

/**
 * The cells of an array when every one is a real number: a real typed buffer,
 * or stored cells with tracked scalar-kind evidence. Real arithmetic on such cells
 * needs no type dispatch and can write straight into a typed buffer.
 */
export function realCells(value: RankArray): ArrayLike<number> | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.scalarOnly) return undefined;
    if (state.typed) return state.typed instanceof Float64Array ? state.typed : undefined;
    const kinds = storedScalarKinds(value);
    return kinds?.every(kind => kind === 'real' || kind === 'numeric-limit')
        ? state.items as unknown as number[] : undefined;
}

/** Copy a completed numeric buffer without a boxed intermediate or type scan. */
export function copyStoredNumericArray(value: RankArray): RankArray | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.scalarOnly || !state.typed || state.validity || value.itemAt !== undefined) return undefined;
    checkpoint('copying numeric array', state.typed.length);
    return createOwned(state.typed.slice(), value.shape, true, value.columnNames);
}

/** Borrow a completed boolean bitmap for callback-free synchronous kernels. */
export function booleanCells(value: RankArray): BooleanCells | undefined {
    const state = ownedStorage.get(value);
    return state?.stable && state.scalarOnly && value.itemAt === undefined ? state.booleans : undefined;
}

/** Writable owned real cells, with the same publication contract as integer cells. */
export function writableRealCells(value: RankArray): ArrayLike<number> | undefined {
    const state = ownedStorage.get(value);
    return state && !state.readOnlyCells ? realCells(value) : undefined;
}

/** Trusted integer cells only, read in place. A bulk integer write preserves this
 * physical kind, but its caller must separately validate the binding's semantic contract. */
export function writableIntegerCells(value: RankArray): ArrayLike<bigint> | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || state.readOnlyCells || !state.scalarOnly) return undefined;
    const kinds = storedScalarKinds(value);
    if (!kinds?.length || !kinds.every(kind => kind === 'integer')) return undefined;
    return state.items as unknown as ArrayLike<bigint>;
}

const fitsInt32 = (value: bigint) => value >= -2147483648n && value <= 2147483647n;

const INT64_MIN = -(1n << 63n), INT64_MAX = (1n << 63n) - 1n;
// Comparing allocates nothing, unlike reading the stored cell back.
const fitsInt64 = (value: bigint) => value >= INT64_MIN && value <= INT64_MAX;

/** Writes one stored cell. An integer buffer keeps an integer that fits in 64
 * bits; any other value turns the buffer into boxed cells first. Callers record
 * the revision and scalar kinds. */
function storeCell(state: OwnedStorage, index: number, value: RankValue): void {
    if (state.booleans && typeof value === 'boolean') { state.booleans.write(index, value); return; }
    let typed = state.typed;
    if (typed instanceof Int32Array && !state.validity && typeof value === 'bigint') {
        if (fitsInt32(value)) {
            typed[index] = Number(value);
            return;
        }
        // Widen before writing; existing borrowed readers follow state.items.
        state.typed = typed = BigInt64Array.from(typed, BigInt);
        state.items = typed as unknown as RankValue[];
    }
    if (typed instanceof BigInt64Array && !state.validity && typeof value === 'bigint' && fitsInt64(value)) {
        typed[index] = value;
        return;
    }
    state.convert?.();
    state.items[index] = value;
}

/** Same-domain scalar writes keep their compact buffer. Other writes pass
 * through the tracked ordinary facade after conversion. */
export function writeArrayCell(value: RankArray, index: number, item: RankValue): void {
    const state = ownedStorage.get(value);
    if (state?.stable && (state.booleans && typeof item === 'boolean'
        || (state.typed instanceof BigInt64Array || state.typed instanceof Int32Array) && !state.validity && typeof item === 'bigint')) {
        state.revision = noteMutation(state.birth);
        storeCell(state, index, item);
    } else {
        value.items[index] = item;
    }
}

/** A scalar boolean fill preserves this storage's physical kind. */
export function hasWritableBooleanCells(value: RankArray): boolean {
    const state = ownedStorage.get(value);
    if (!state?.stable || state.readOnlyCells || !state.scalarOnly || state.typed) return false;
    const kinds = storedScalarKinds(value);
    return kinds?.length === 1 && kinds[0] === 'boolean';
}

/** Ownership, selection bounds and the binding contract are checked by the caller. */
export function fillBooleanSelection(
    value: RankArray, count: number, offsetAt: (index: number) => number, operand: boolean,
): void {
    const state = ownedStorage.get(value)!;
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.bulkArrayWrites++; diagnostics.bulkArrayWriteCells += count; }
    state.revision = noteMutation(state.birth);
    for (let i = 0; i < count; i++) {
        checkpoint('writing array');
        if (state.booleans) state.booleans.write(offsetAt(i), operand);
        else state.items[offsetAt(i)] = operand;
    }
}

/** Commit a prevalidated integer selection without per-cell Proxy traffic.
 * Callers have protected ownership, established an integer binding, and removed
 * lazy reads/callbacks from operands and offsets. Compound writes accumulate
 * repeated offsets. Snapshot writes instead supply precomputed replacements
 * with '=' when offsets are not proven unique. */
export function writeIntegerSelection(
    value: RankArray, count: number, offsetAt: (index: number) => number,
    operand: bigint | readonly bigint[], operator: '=' | '+=' | '-=' | '*=',
): void {
    const state = ownedStorage.get(value)!;
    const diagnostics = currentDiagnostics();
    if (diagnostics) { diagnostics.bulkArrayWrites++; diagnostics.bulkArrayWriteCells += count; }
    state.revision = noteMutation(state.birth);
    // Choose the operator once: no operator dispatch, broadcasting allocation,
    // scalar-kind changes or user code during the commit.
    const combine = operator === '=' ? (_: bigint, next: bigint) => next
        : operator === '+=' ? (old: bigint, next: bigint) => old + next
        : operator === '-=' ? (old: bigint, next: bigint) => old - next
        : (old: bigint, next: bigint) => old * next;
    for (let i = 0; i < count; i++) {
        checkpoint('writing array');
        const offset = offsetAt(i);
        // Read through state.items: a write that does not fit replaces the buffer.
        const old = state.items[offset] as bigint;
        storeCell(state, offset, combine(old, typeof operand === 'bigint' ? operand : operand[i]));
    }
}

/** Reduce trusted integer updates without retaining a boxed RHS cell per input.
 * Safe integer partials use Number exactly; a bucket promotes to BigInt before
 * any addition/product can round. No destination is written while reading. */
export function reduceIntegerUpdates(size: number, count: number, offsetAt: (index: number) => number,
    read: (index: number) => bigint, product: boolean): { offsets: number[]; operands: bigint[] } {
    const numbers = new Float64Array(size), states = new Uint8Array(size);
    const wide = new Map<number, bigint>();
    for (let start = 0; start < count; start += 4096) {
        const end = Math.min(count, start + 4096);
        checkpoint('reducing integer updates', end - start);
        for (let index = start; index < end; index++) {
            const offset = offsetAt(index), value = read(index);
            if (states[offset] === 2) {
                const previous = wide.get(offset)!;
                wide.set(offset, product ? previous * value : previous + value);
                continue;
            }
            const number = Number(value), previous = numbers[offset];
            const next = states[offset] === 0 ? number : product ? previous * number : previous + number;
            if (Number.isSafeInteger(number) && Number.isSafeInteger(next)) {
                numbers[offset] = next;
                states[offset] = 1;
            } else {
                wide.set(offset, states[offset] === 0 ? value
                    : product ? BigInt(previous) * value : BigInt(previous) + value);
                states[offset] = 2;
            }
        }
    }
    const offsets: number[] = [], operands: bigint[] = [];
    for (let offset = 0; offset < size; offset++) {
        checkpoint('preparing integer updates');
        if (!states[offset]) continue;
        offsets.push(offset);
        operands.push(states[offset] === 2 ? wide.get(offset)! : BigInt(numbers[offset]));
    }
    return { offsets, operands };
}

/** Dense repeated scalar updates can count addresses before touching storage.
 * Counts fit exactly in Number (they are bounded by the selection size); all
 * arithmetic involving Rank integers remains BigInt. Sparse selections and
 * opaque polling retain the ordinary cancellable writer. */
export function accumulateIntegerSelection(
    value: RankArray, count: number, offsetAt: (index: number) => number,
    operand: bigint | readonly bigint[], operator: '+=' | '-=' | '*=',
): void {
    const size = ownedStorage.get(value)!.items.length;
    if (typeof operand !== 'bigint' || count < 4 * size || !privateLoopPolling()) {
        writeIntegerSelection(value, count, offsetAt, operand, operator);
        return;
    }
    const counts = new Float64Array(size);
    for (let start = 0; start < count; start += 4096) {
        const end = Math.min(count, start + 4096);
        checkpoint('counting array updates', end - start);
        for (let index = start; index < end; index++) counts[offsetAt(index)]++;
    }
    const offsets: number[] = [], operands: bigint[] = [];
    for (let offset = 0; offset < size; offset++) {
        checkpoint('reducing array updates');
        if (!counts[offset]) continue;
        offsets.push(offset);
        const multiplicity = BigInt(counts[offset]);
        // Avoid building a huge product that a zero destination annihilates.
        operands.push(operator === '*='
            ? ownedStorage.get(value)!.items[offset] === 0n ? 0n : operand ** multiplicity
            : operand * multiplicity);
    }
    writeIntegerSelection(value, offsets.length, index => offsets[index], operands, operator);
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
    columnNames?: readonly string[], metadata?: ArrayMetadata,
): RankArray {
    let scalarKinds: Map<string, number> | undefined;
    if (!columnNames) {
        let firstType: string | undefined;
        let firstRank: number | undefined;
        let firstScalarKind: string | undefined;
        let kinds: Map<string, { type: string; rank?: number }> | undefined;
        for (const item of items) {
            const type = typeof item === 'number' && !Number.isFinite(item) && !Number.isNaN(item)
                ? 'numeric-limit' : typeName(item);
            const rank = isRankArray(item) ? item.shape.length : undefined;
            if (firstType === undefined) { firstType = type; firstRank = rank; firstScalarKind = scalarKind(item); }
            else if (type !== firstType || rank !== firstRank) {
                // Homogeneous arrays need no per-cell descriptors or type-key strings.
                kinds ??= new Map([[`${firstType}:${firstRank}`, { type: firstType, rank: firstRank }]]);
                const key = `${type}:${rank}`;
                if (!kinds.has(key)) kinds.set(key, { type, rank });
            }
        }
        if (kinds) requireHomogeneous([...kinds.values()]);
        else {
            // Validation already proved every cell has the same primitive kind.
            // Preserve that count for binding/return contracts and later writes.
            const kind = firstScalarKind;
            if (kind || items.length === 0) scalarKinds = new Map(kind ? [[kind, items.length]] : []);
        }
    }
    if (scalarKinds?.size === 1 && scalarKinds.has('boolean')) return createOwned(BooleanCells.from(items as boolean[]), shape, true, columnNames, undefined, metadata);
    const packed = scalarKinds?.size === 1 && scalarKinds.has('integer') ? packedIntegers(items) : undefined;
    if (packed) return createOwned(packed, shape, true, columnNames, undefined, metadata);
    const value = createOwned(items, shape, scalarOnly, columnNames, undefined, metadata);
    if (scalarKinds) ownedStorage.get(value)!.elementKinds = scalarKinds;
    return value;
}

/** Takes fresh cells selected from storage with one proved primitive kind.
 * Internal kernels must preserve that kind; this is not a validation entry. */
export function ownedScalarArray(items: RankValue[], kind: string, shape: readonly number[] = [items.length]): RankArray {
    if (kind === 'boolean') return createOwned(BooleanCells.from(items as boolean[]), shape, true);
    const packed = kind === 'integer' ? packedIntegers(items) : undefined;
    if (packed) return typedArray(packed, shape);
    const value = createOwned(items, shape, true);
    ownedStorage.get(value)!.elementKinds = new Map(items.length ? [[kind, items.length]] : []);
    return value;
}

/** A scalar fill establishes its physical kind once, including for an empty
 * shape. Nested/missing fills keep the ordinary storage and validity rules. */
export function filledArray(fill: RankValue, shape: readonly number[]): RankArray {
    const size = Number(shape.reduce((product, dimension) => product * BigInt(dimension), 1n));
    if (typeof fill === 'boolean') {
        const cells = new BooleanCells(size);
        if (fill) { cells.words.fill(0xffffffff); cells.trim(); }
        return createOwned(cells, shape, true);
    }
    if (typeof fill === 'bigint' && size >= PACKED_CELLS && fitsInt64(fill)) {
        return typedArray(fitsInt32(fill) ? new Int32Array(size).fill(Number(fill)) : new BigInt64Array(size).fill(fill), shape);
    }
    const items = Array(size).fill(fill) as RankValue[];
    const kind = scalarKind(fill);
    if (!kind) return ownedArray(items, shape);
    const value = createOwned(items, shape, true);
    ownedStorage.get(value)!.elementKinds = new Map(size ? [[kind, size]] : []);
    return value;
}

/** An array held in a typed buffer: four-byte or eight-byte integers, or
 * eight-byte reals. Integer writes widen Int32 to Int64 before falling back to
 * arbitrary-precision cells. Public `items` materializes tracked boxed cells.
 * Takes ownership of `data`. */
export function typedArray(
    data: Float64Array | BigInt64Array | Int32Array, shape: readonly number[] = [data.length],
    columnNames?: readonly string[],
): RankArray {
    return createOwned(data, shape, true, columnNames);
}

/** Integer arrays from this size up are packed. Smaller ones stay boxed, since
 * every read from a typed buffer allocates a new bigint. */
const PACKED_CELLS = 4096;

/** Fresh integer cells in one buffer, when there are enough of them and every
 * one fits in 64 bits. */
function packedIntegers(items: RankValue[]): BigInt64Array | undefined {
    if (items.length < PACKED_CELLS) return undefined;
    const packed = new BigInt64Array(items.length);
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (typeof item !== 'bigint' || !fitsInt64(item)) return undefined;
        packed[index] = item;
    }
    return packed;
}

/** Builds the cells of a fresh integer array: packed in one BigInt64Array, or
 * exact bigints from the first value that does not fit in 64 bits. */
export class IntegerCells {
    private packed?: BigInt64Array;
    private exact?: bigint[];

    constructor(size: number) {
        if (size >= PACKED_CELLS) this.packed = new BigInt64Array(size);
        else this.exact = new Array(size);
    }

    set(index: number, value: bigint): void {
        const packed = this.packed;
        if (packed) {
            if (fitsInt64(value)) {
                packed[index] = value;
                return;
            }
            this.exact = Array.from(packed);
            this.packed = undefined;
        }
        this.exact![index] = value;
    }

    array(shape: readonly number[]): RankArray {
        return this.packed ? typedArray(this.packed, shape) : ownedScalarArray(this.exact!, 'integer', shape);
    }
}

/** A typed array over a buffer someone else keeps, such as a table column. It
 * starts out shared, so the first write copies the buffer rather than changing it. */
export function sharedTypedArray(data: Float64Array | BigInt64Array | Int32Array, shape: readonly number[]): RankArray {
    const value = typedArray(data, shape);
    ownedStorage.get(value)!.owners = SHARED;
    return value;
}

/** Shape-only value copy. Rank writes through either value detach the buffer. */
export function reshapeStoredArray(value: RankArray, shape: readonly number[]): RankArray | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.scalarOnly || state.validity || state.readOnlyCells) return undefined;
    const result = createOwned(state.booleans ?? state.typed ?? state.items, shape, true);
    state.owners = SHARED;
    const reshaped = ownedStorage.get(result)!;
    reshaped.owners = SHARED;
    return result;
}

/** The element type of an array still held in a typed buffer. */
export function typedElementKind(value: RankArray): 'integer' | 'real' | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.typed || state.validity) return undefined;
    return state.typed instanceof Float64Array ? 'real' : 'integer';
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

/** Numeric storage with validity, without materializing missing cells. */
export function maskedNumericCells(value: RankArray): { values: Float64Array | BigInt64Array; validity: Uint32Array } | undefined {
    const state = ownedStorage.get(value);
    if (!state?.stable || !state.validity || !state.typed || state.typed instanceof Int32Array) return undefined;
    return { values: state.typed, validity: state.validity };
}

export function hasMaskedCells(value: RankArray): boolean {
    return ownedStorage.get(value)?.validity !== undefined;
}

function changedCell(state: OwnedStorage, value: RankValue): void {
    state.revision = noteMutation(state.birth);
    state.resources.include(value);
    state.stored.include(value);
    state.scalarOnly &&= typeof value !== 'object';
}

function uncertainStorage(state: OwnedStorage): void {
    state.revision = noteMutation(state.birth);
    state.resources.invalidate();
    state.stored.invalidate();
    state.scalarOnly = false;
    state.stable = false;
    state.elementKinds = undefined;
}

// Non-cell writes (length, new indexes, metadata) cannot update a cell count.
function previousCell(state: OwnedStorage, target: RankValue[], key: PropertyKey): RankValue | undefined {
    if (!state.elementKinds || typeof key !== 'string') return undefined;
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < target.length && String(index) === key
        ? target[index] : undefined;
}

/** Trap methods are shared; only the state reference belongs to each items facade. */
class OwnedItemsHandler implements ProxyHandler<RankValue[]> {
    constructor(private readonly state: OwnedStorage) {}

    set(target: RankValue[], key: PropertyKey, value: RankValue): boolean {
        const state = this.state;
        const previous = previousCell(state, target, key);
        const length = target.length;
        const success = Reflect.set(target, key, value, target);
        if (success) {
            updateScalarKinds(state, previous, value);
            changedCell(state, value);
        } else if (target.length !== length) {
            // A failed length shrink may already have deleted trailing cells.
            state.elementKinds = undefined;
            state.revision = noteMutation(state.birth);
        }
        return success;
    }
    defineProperty(target: RankValue[], key: PropertyKey, descriptor: PropertyDescriptor): boolean {
        const state = this.state;
        const previous = previousCell(state, target, key);
        const length = target.length;
        const success = Reflect.defineProperty(target, key, descriptor);
        if (success) {
            if (descriptor.writable === false) state.readOnlyCells = true;
            if ('get' in descriptor || 'set' in descriptor) uncertainStorage(state);
            else if ('value' in descriptor) {
                updateScalarKinds(state, previous, descriptor.value);
                changedCell(state, descriptor.value);
            }
            else state.revision = noteMutation(state.birth);
        } else if (target.length !== length) {
            state.elementKinds = undefined;
            state.revision = noteMutation(state.birth);
        }
        return success;
    }
    deleteProperty(target: RankValue[], key: PropertyKey): boolean {
        const success = Reflect.deleteProperty(target, key);
        if (success) {
            this.state.elementKinds = undefined;
            this.state.revision = noteMutation(this.state.birth);
        }
        return success;
    }
    setPrototypeOf(target: RankValue[], prototype: object | null): boolean {
        const success = Reflect.setPrototypeOf(target, prototype);
        if (success) uncertainStorage(this.state);
        return success;
    }
}

// Raw value objects are fresh per array, so their state supports one static handler.
// The public items property remains a data property for ordinary boxed storage.
const ownedValueHandler: ProxyHandler<RankArray> = {
    set(target, key, replacement) {
        const success = Reflect.set(target, key, replacement, target);
        if (success) uncertainStorage(ownedStorage.get(target)!);
        return success;
    },
    defineProperty(target, key, descriptor) {
        const success = Reflect.defineProperty(target, key, descriptor);
        if (success) uncertainStorage(ownedStorage.get(target)!);
        return success;
    },
    deleteProperty(target, key) {
        const success = Reflect.deleteProperty(target, key);
        if (success) uncertainStorage(ownedStorage.get(target)!);
        return success;
    },
    setPrototypeOf(target, prototype) {
        const success = Reflect.setPrototypeOf(target, prototype);
        if (success) uncertainStorage(ownedStorage.get(target)!);
        return success;
    },
};

/** Rank-facing reads preserve integer values. Numeric kernels borrow the raw
 * buffer separately; public items still materialize an ordinary tracked array. */
function integer32Items(cells: Int32Array): ArrayLike<bigint> & Iterable<bigint> {
    return new Proxy({ length: cells.length,
        *[Symbol.iterator]() { for (const cell of cells) yield BigInt(cell); },
        slice(start: number, end: number) { return BigInt64Array.from(cells.subarray(start, end), BigInt); },
    }, {
        get(target, key, receiver) {
            if (typeof key === 'string') {
                const index = Number(key);
                if (Number.isInteger(index) && index >= 0 && String(index) === key) {
                    return index < cells.length ? BigInt(cells[index]) : undefined;
                }
            }
            return Reflect.get(target, key, receiver);
        },
    }) as unknown as ArrayLike<bigint> & Iterable<bigint>;
}

/** Trusted raw cells for number-only kernels, never exposed as Rank reals. */
export function integer32Cells(value: RankArray): Int32Array | undefined {
    const state = ownedStorage.get(value);
    return state?.stable && !state.validity && state.typed instanceof Int32Array ? state.typed : undefined;
}

/** Publish an already guarded private integer region without boxing each cell.
 * Refuse the whole batch before its first store if widening is needed. Ownership
 * and semantic contracts are proved by the caller, as for the scalar writer. */
export function writeInteger32Cells(value: RankArray, cells: ArrayLike<number | bigint>, dirty: Uint8Array): boolean {
    const state = ownedStorage.get(value);
    const target = state?.stable && !state.readOnlyCells && !state.validity ? state.typed : undefined;
    if (!(target instanceof Int32Array)) return false;
    for (let index = 0; index < dirty.length; index++) {
        if (dirty[index]) {
            const cell = cells[index];
            if (typeof cell !== 'number' || cell !== (cell | 0)) return false;
        }
    }
    state!.revision = noteMutation(state!.birth);
    for (let index = 0; index < dirty.length; index++) {
        if (dirty[index]) target[index] = cells[index] as number;
    }
    return true;
}

export function createOwned(
    cells: RankValue[] | Float64Array | BigInt64Array | Int32Array | BooleanCells, shape: readonly number[], scalarOnly: boolean,
    columnNames?: readonly string[], validity?: Uint32Array, metadata?: ArrayMetadata,
): RankArray {
    const booleans = cells instanceof BooleanCells ? cells : undefined;
    const typed = Array.isArray(cells) || cells instanceof BooleanCells ? undefined : cells;
    const items = (booleans ? booleanItems(booleans) : cells instanceof Int32Array ? integer32Items(cells) : cells) as RankValue[];
    if (!typed && !scalarOnly) {
        // Cells with no value are kept beside a numeric buffer, not in it.
        const found = scanForMissing(items);
        if (found === 'scalar') scalarOnly = true;
        else if (found) return createOwned(found.values, shape, false, columnNames, found.validity, metadata);
    }
    const state: OwnedStorage = {
        items, typed, booleans, validity, shape: [...shape], revision: writeRevision, birth: nextCreationSerial(),
        scalarOnly: !validity && (typed !== undefined || scalarOnly || items.every(item => typeof item !== 'object')),
        stable: true, resources: undefined!, stored: undefined!,
    };
    state.resources = new ResourceSummary(() => state.scalarOnly && state.stable);
    state.stored = new StoredValueSummary(() => state.stable && (state.scalarOnly || state.validity !== undefined));
    if (!state.scalarOnly && !typed) for (const item of items) state.resources.include(item);
    if (!state.scalarOnly && !typed) for (const item of items) state.stored.include(item);
    const raw = { kind: 'array' as const, items: undefined as unknown as RankValue[], shape: Object.freeze([...shape]),
        ...metadata,
        ...(columnNames === undefined ? {} : { columnNames: Object.freeze([...columnNames]) }) };
    if (typed || booleans) {
        Object.defineProperty(raw, 'items', { configurable: true, enumerable: true, get: () => { state.convert!(); return raw.items; } });
        state.convert = () => {
            const diagnostics = currentDiagnostics();
            if (diagnostics) {
                diagnostics.typedUnpacks++;
                diagnostics.typedUnpackedCells += state.items.length;
            }
            const plain = Array.from(state.items);
            if (state.validity) {
                const bits = state.validity;
                for (let index = 0; index < plain.length; index += 1) {
                    if (!(bits[index >>> 5] >>> (index & 31) & 1)) plain[index] = MISSING;
                }
                state.validity = undefined;
            }
            state.items = plain;
            state.typed = undefined;
            state.booleans = undefined;
            state.convert = undefined;
            Object.defineProperty(raw, 'items', { value: new Proxy(plain, new OwnedItemsHandler(state)), writable: true, enumerable: true, configurable: true });
        };
    } else {
        raw.items = new Proxy(items, new OwnedItemsHandler(state));
    }
    ownedStorage.set(raw, state);
    const value: RankArray = new Proxy(raw, ownedValueHandler);
    ownedStorage.set(value, state);
    state.stored.track(raw);
    state.stored.track(value);
    return state.resources.track(value);
}

/** Prepare once per compiled region; avoid a WeakMap lookup on each write. */
export function prepareScalarArrayWriter(value: RankValue | undefined, batch = false): (index: number, item: bigint | number | boolean | string) => void {
    const array = value as RankArray;
    const state = array && borrowedStorage.get(array);
    if (!state) return (index, item) => { writeArrayCell(array, index, item); };
    let changed = false;
    return (index, item) => {
        // Batching is allowed only in a compiler-proved region with no lazy
        // reads or callbacks. Publish before its first write, including errors.
        if (!batch || !changed) {
            state.revision = noteMutation(state.birth);
            changed = true;
        }
        // Typed buffers track no kinds, and reading their old cell allocates.
        if (state.elementKinds) updateScalarKinds(state, state.items[index], item);
        storeCell(state, index, item);
    };
}
