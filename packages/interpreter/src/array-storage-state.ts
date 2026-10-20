import type { RankArray, RankValue } from './value.js';
import type { ResourceSummary } from './resource-summary.js';

export interface OwnedStorage {
    /** The cells. Typed storage stands in here while `typed` is set: only index
     * and length reads are valid on it, and `convert` swaps in a plain array. */
    items: RankValue[];
    typed?: Float64Array | BigInt64Array;
    /** Bit i set means cell i of `typed` has a value; absent when every cell has one.
     * The buffer holds 0 in a cell without a value. A masked array is not
     * `scalarOnly`: kernels that do not read the bits must not see its buffer. */
    validity?: Uint32Array;
    convert?: () => void;
    /** Physical scalar kinds, counted on demand and maintained by tracked writes.
     * This is storage evidence, not a declaration of a binding's domain. */
    elementKinds?: Map<string, number>;
    shape: readonly number[];
    revision: number;
    birth: number;
    scalarOnly: boolean;
    stable: boolean;
    readOnlyCells?: boolean;
    resources: ResourceSummary;
    owners?: number;
    nestedEpoch?: number;
    checkedBirth?: number;
    nestedRevision?: number;
}
export let writeRevision = 0;
export let creationSerial = 0;

// A buffer we cannot track changes only while the host holds control: a JS
// caller writing its own array is not running Rank at that moment. A reader
// over one may therefore keep its cells for one stretch of work we were asked
// to do, and reads live again as soon as control could have left us. Without
// that, a reader standing on a reader recomputes the chain below it for every
// cell, and a loop whose step reads the step before it twice — gradient
// descent — costs an exponent in its number of steps.
export let runtimeDepth = 0;
export let hostEntry = 0;

/** Opens a stretch of work the host asked for. Nested calls extend the one
 * already open; only the outermost hands control back. */
export function enterRuntime(): void { runtimeDepth += 1; }
export function leaveRuntime(): void { if ((runtimeDepth -= 1) === 0) hostEntry += 1; }

const mutationBirths = new Float64Array(1024);

export function noteMutation(birth: number): number {
    mutationBirths[++writeRevision % mutationBirths.length] = birth;
    return writeRevision;
}

// Old expressions cannot depend on objects created after their last full
// validation, unless an older parent was changed to reference those objects.
// Keep a bounded write journal; missing history simply triggers a full check.
export function onlyNewObjectsChanged(epoch: number, checkedBirth: number): boolean {
    if (epoch < 0 || writeRevision - epoch > mutationBirths.length) return false;
    for (let entry = epoch + 1; entry <= writeRevision; entry++) {
        if (mutationBirths[entry % mutationBirths.length] <= checkedBirth) return false;
    }
    return true;
}
export const ownedStorage = new WeakMap<RankArray, OwnedStorage>();

export function nextCreationSerial(): number { return ++creationSerial; }

// A DAG can reference the same derived source repeatedly (matrix squaring).
// Validate each node once per write epoch, rather than expanding every path.
export const derivedRevisions = new WeakMap<object, {
    values: () => Iterable<RankValue>; own?: () => number;
    epoch: number; cached?: number; checkedBirth?: number;
    // What binding this reader has to freeze; a reader over no stored array
    // has none, so only the readers that can be frozen carry the list.
    sources?: readonly RankArray[];
    owners?: number;
}>();

export type DerivedRecord = NonNullable<ReturnType<typeof derivedRevisions.get>>;

export const SHARED = 2;
