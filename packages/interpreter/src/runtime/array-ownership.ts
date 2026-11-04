/// <reference lib="es2021.weakref" />
import { BooleanCells } from './boolean-cells.js';
import { checkpoint } from '../interrupt.js';
import { currentDiagnostics } from '../diagnostics.js';
import type { RankArray, RankValue } from './value.js';
import { ownedStorage, derivedRevisions, SHARED } from './array-storage-state.js';
import { createOwned, ownedArray, denseScalarItems, isFlatScalarArray } from './owned-array.js';
// Scoped local bindings are counted exactly and released on overwrite or
// completion. Opaque owners (globals, containers, lazy readers and observers)
// retain conservative marks. A write copies whenever their combined count
// exceeds one; releasing a local can never remove an opaque owner.

// Storage the runtime owns and readers it built already carry a record, and a
// binding is frequent enough that a table of its own would be felt: an inner
// loop binds a row and an intermediate on every pass. Only arrays reaching us
// from a host buffer or a plain literal need one.
interface Ownership { owners?: number; bindings?: number }
const foreignOwners = new WeakMap<RankArray, Ownership>();

function ownership(value: RankArray): Ownership | undefined {
    return ownedStorage.get(value) ?? derivedRevisions.get(value) ?? foreignOwners.get(value);
}

function bindingCount(value: RankArray): number {
    const state = ownership(value);
    return (state?.owners ?? 0) + (state?.bindings ?? 0);
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

// Retained scalar selections can detach just their cells before a Rank write.
// Weak references keep an unmodified, long-lived source from owning its readers.
interface SelectionSnapshot {
    source?: RankArray;
    freeze?: () => boolean;
    reference?: WeakRef<SelectionSnapshot>;
}
const selectionSnapshots = new WeakMap<RankArray, SelectionSnapshot>();
const pendingSelections = new WeakMap<RankArray, Set<WeakRef<SelectionSnapshot>>>();
const releasedSelections = typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry<{ pending: Set<WeakRef<SelectionSnapshot>>; reference: WeakRef<SelectionSnapshot> }>(
        ({ pending, reference }) => pending.delete(reference)) : undefined;

/** Only selector plans over trusted scalar storage qualify. Reading the selection
 * remains lazy/live across host writes until Rank itself writes its source. */
export function retainSelectionSnapshot(value: RankArray, source: RankArray,
    offsetAt: (index: number) => number, detached: (snapshot: RankArray) => void): void {
    if (!releasedSelections || typeof WeakRef !== 'function' || !denseScalarItems(source)) return;
    const shape = value.shape;
    selectionSnapshots.set(value, { source, freeze() {
        const stored = denseScalarItems(source);
        if (!stored || ownedStorage.get(source)?.readOnlyCells) return false;
        const size = shape.reduce((a, b) => a * b, 1);
        const bits = ownedStorage.get(source)?.booleans;
        const cells = bits ? new BooleanCells(size) : undefined;
        if (cells && bits) for (let index = 0; index < size; index++) {
            if ((index & 4095) === 0) checkpoint('snapshotting selection', Math.min(4096, size - index));
            cells.write(index, bits.read(offsetAt(index)));
        }
        const items = cells ?? Array.from({ length: size }, (_, index) => {
            if ((index & 4095) === 0) checkpoint('snapshotting selection', Math.min(4096, size - index));
            return stored[offsetAt(index)];
        });
        // Keep the selection's own lazy validation and read-only interface.
        // This private buffer must not establish a semantic declaration.
        const snapshot = createOwned(items, shape, true);
        detached(snapshot);
        const diagnostics = currentDiagnostics();
        if (diagnostics) {
            diagnostics.selectionSnapshots++;
            diagnostics.selectionSnapshotCells += size;
        }
        return true;
    } });
}

/** A value that reads `source` later must see it as it is now. Binding the
 * value shares the source, so a later write to it copies instead. */
export function holdArraySource(value: RankArray, source: RankArray): void {
    heldSources.set(value, [...(heldSources.get(value) ?? []), source]);
    if (bindingCount(value) > 0) shareSources(value);
}

function shareSources(value: RankArray): void {
    const pending = [value];
    while (pending.length) {
        const current = pending.pop()!;
        const selection = selectionSnapshots.get(current);
        if (selection?.freeze) {
            if (!selection.reference) {
                let retained = pendingSelections.get(selection.source!);
                if (!retained) pendingSelections.set(selection.source!, retained = new Set());
                // The weak target is a small ticket, not the reader: WeakRef
                // keeps its target alive until the host job ends. In particular
                // it must not retain the reader's potentially large cell cache.
                const reference = selection.reference = new WeakRef(selection);
                retained.add(reference);
                releasedSelections!.register(selection, { pending: retained, reference }, reference);
            }
        }
        const dependencies = selection?.freeze ? [] : derivedRevisions.get(current)?.sources ?? [];
        for (const source of [...dependencies, ...heldSources.get(current) ?? []]) {
            const record = ownershipFor(source);
            if (record.owners === SHARED) continue;
            record.owners = SHARED;
            pending.push(source);
        }
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

/** Explicit local bindings can end without releasing opaque retained owners.
 * Only completed native scalar storage enters this scope. Readers, containers
 * and captures continue to use the conservative ownership marks above. */
export class ArrayBindingScope {
    private readonly values = new Map<string | number, RankArray>();

    constructor(private readonly beforeRelease?: (value: RankArray) => void) {}

    bind(key: string | number, value: RankValue, borrowed = false): void {
        const previous = this.values.get(key);
        if (previous === value && !borrowed) return;
        // Retain first: rebinding an alias must never create a false unique gap.
        const tracked = !borrowed && typeof value === 'object'
            && value.kind === 'array' && isFlatScalarArray(value);
        if (tracked) {
            shareSources(value);
            const state = ownershipFor(value);
            state.bindings = (state.bindings ?? 0) + 1;
        } else if (!borrowed) noteArrayBinding(value);
        this.release(key);
        if (borrowed) noteArrayBorrow(value);
        if (tracked) this.values.set(key, value);
    }

    release(key: string | number): void {
        const value = this.values.get(key);
        if (!value) return;
        this.beforeRelease?.(value);
        this.values.delete(key);
        const state = ownershipFor(value);
        state.bindings = state.bindings! - 1;
    }

    /** Completion has no continuation that can observe retired arguments. */
    clear(): void {
        for (const value of this.values.values()) {
            const state = ownershipFor(value);
            state.bindings = state.bindings! - 1;
        }
        this.values.clear();
    }

    /** An observer can retain these values after the lexical scope ends. */
    escape(): void {
        for (const value of this.values.values()) noteArrayBinding(value);
        this.clear();
    }
}

/** Ensures that a borrowed array has at least one binding recorded (owners = 1),
 * but does not mark it shared (owners = 2). */
export function noteArrayBorrow(value: RankValue): void {
    if (typeof value !== 'object' || value.kind !== 'array') return;
    const record = ownershipFor(value);
    if (bindingCount(value) === 0) {
        shareSources(value);
        record.owners = 1;
    }
}

/** A retained selection can poll while detaching; private loop commits must
 * leave these writes to the ordinary publishing backend. */
export function hasPendingSelections(value: RankArray): boolean {
    return (pendingSelections.get(value)?.size ?? 0) > 0;
}

/** True when a write must first protect aliases or retained selections. */
export function isSharedArray(value: RankValue): boolean {
    return typeof value === 'object' && value.kind === 'array'
        && (bindingCount(value) >= SHARED || (pendingSelections.get(value)?.size ?? 0) > 0
            || sharesNumericSlices(value));
}

/** Numeric slice bounds refer to the current buffer only. Boxing or widening
 * detaches that buffer, so its old views no longer constrain source writes. */
function sharesNumericSlices(value: RankArray): boolean {
    const state = ownedStorage.get(value);
    return state?.typed !== undefined && state.slices?.cells === state.typed;
}

/** Storage this name owns alone. The result is unbound: the caller binds it. */
export function privateArrayCopy(value: RankArray): RankArray {
    const stored = ownedStorage.get(value);
    if (stored?.booleans) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) { diagnostics.cowCopies++; diagnostics.cowCopiedCells += stored.booleans.length; }
        return createOwned(stored.booleans.slice(), value.shape, true, value.columnNames);
    }
    if (stored?.typed) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) {
            diagnostics.cowCopies++;
            diagnostics.cowCopiedCells += stored.typed.length;
            const cost = diagnostics.cost('array.cow');
            const bytes = stored.typed.byteLength + (stored.validity?.byteLength ?? 0);
            cost.allocatedBytes += bytes;
            cost.copiedBytes += bytes;
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

/** Protect aliases and retained selections before a Rank write. The half-open
 * range proves which cells may change; one offset proves a scalar address.
 * Missing or invalid bounds conservatively protect the whole value. */
export function arrayForWrite(value: RankValue, offset?: number, end = offset === undefined ? undefined : offset + 1): RankArray | undefined {
    // Host descriptors can invalidate writable storage even without an alias.
    if (typeof value === 'object' && value.kind === 'array') {
        const stored = ownedStorage.get(value);
        if (stored && (!stored.stable || stored.readOnlyCells)) return privateArrayCopy(value);
        if (sharesNumericSlices(value)) {
            const bounds = stored!.slices!;
            if (offset === undefined || end === undefined || !Number.isSafeInteger(offset) || !Number.isSafeInteger(end)
                || offset < 0 || end <= offset || offset < bounds.end && end > bounds.start) return privateArrayCopy(value);
        }
    }
    if (!isSharedArray(value)) return undefined;
    const source = value as RankArray;
    // Ordinary aliases still require a whole-value copy; their lazy readers
    // can keep reading the old source without detaching anything.
    if (bindingCount(source) >= SHARED) return privateArrayCopy(source);
    const pending = pendingSelections.get(source);
    if (!pending) return undefined;
    for (const reference of pending) {
        const selection = reference.deref();
        if (selection?.freeze && !selection.freeze()) {
            // The host changed the storage guarantees since selection.
            // Preserve its reader and take the conservative value-copy path.
            ownershipFor(source).owners = SHARED;
            return privateArrayCopy(source);
        }
        if (selection) {
            selection.source = undefined;
            selection.freeze = undefined;
        }
        releasedSelections!.unregister(reference);
        pending.delete(reference);
    }
    pendingSelections.delete(source);
    return undefined;
}
