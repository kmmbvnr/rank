import { RankError } from './errors.js';
import { ResourceSummary } from './resource-summary.js';
import { StoredValueSummary } from './stored-value.js';
import type { RankArray, RankObject, RankValue } from './value.js';
import {
    ownedStorage, derivedRevisions, writeRevision, creationSerial, onlyNewObjectsChanged, noteMutation,
    nextCreationSerial, type OwnedStorage, type DerivedRecord,
} from './array-storage-state.js';

/** Unknown host storage has no reliable revision and must not retain derived caches. */
export function arrayRevision(value: RankArray): number | undefined {
    return valueRevision(value);
}

/** Inspect declared dependencies without evaluating a native cell recipe. */
export function arrayResourceValues(value: RankArray): Iterable<RankValue> | undefined {
    return derivedRevisions.get(value)?.values();
}

const revisiting = new WeakSet<object>();
interface RevisionFrame {
    value: object;
    values: Iterator<RankValue>;
    revision: number | undefined;
    derived?: DerivedRecord;
    owned?: OwnedStorage;
}

// Return cached leaves immediately. Unchecked containers describe their children
// to the iterative walk, so neither nesting nor a long lazy DAG uses host frames.
function revisionFrame(value: RankValue): number | undefined | RevisionFrame {
    if (typeof value !== 'object') return 0;
    if (revisiting.has(value)) return undefined;
    const derived = derivedRevisions.get(value);
    if (derived) {
        if (derived.epoch === writeRevision) return derived.cached;
        if (onlyNewObjectsChanged(derived.epoch, derived.checkedBirth ?? 0)) {
            derived.epoch = writeRevision;
            return derived.cached;
        }
        return { value, values: derived.values()[Symbol.iterator](),
            revision: derived.own?.() ?? 0, derived };
    }
    const state = ownedStorage.get(value as RankArray);
    if (!state?.stable) return undefined;
    if (state.scalarOnly || state.validity) return state.revision;
    if (state.nestedEpoch === writeRevision) return state.nestedRevision;
    if (state.nestedEpoch !== undefined
        && onlyNewObjectsChanged(state.nestedEpoch, state.checkedBirth ?? 0)) {
        state.nestedEpoch = writeRevision;
        return state.nestedRevision;
    }
    return { value, values: state.items[Symbol.iterator](), revision: state.revision, owned: state };
}

function valueRevision(value: RankValue): number | undefined {
    const first = revisionFrame(value);
    if (typeof first !== 'object') return first;
    const stack = [first];
    revisiting.add(first.value);
    try {
        while (stack.length) {
            const frame = stack[stack.length - 1];
            const child = frame.revision === undefined ? undefined : frame.values.next();
            if (child && !child.done) {
                const next = revisionFrame(child.value);
                if (typeof next === 'object') {
                    revisiting.add(next.value);
                    stack.push(next);
                } else {
                    frame.revision = next === undefined ? undefined : Math.max(frame.revision!, next);
                }
                continue;
            }
            if (!child) frame.values.return?.();
            if (frame.derived) {
                frame.derived.cached = frame.revision;
                frame.derived.epoch = writeRevision;
                frame.derived.checkedBirth = creationSerial;
            } else {
                frame.owned!.nestedRevision = frame.revision;
                frame.owned!.nestedEpoch = writeRevision;
                frame.owned!.checkedBirth = creationSerial;
            }
            revisiting.delete(frame.value);
            stack.pop();
            if (!stack.length) return frame.revision;
            const parent = stack[stack.length - 1];
            parent.revision = frame.revision === undefined ? undefined : Math.max(parent.revision!, frame.revision);
        }
    } finally {
        for (const frame of stack) revisiting.delete(frame.value);
    }
    return undefined;
}

const MAX_LAZY_ARRAY_DEPTH = 8192;
export const lazyDepth = new WeakMap<RankArray, number>();

/** Count reader layers, not the height of metadata-only dependency DAGs.
 * In particular balanced concat ropes do not grow one layer per append. */
export function arrayReaderDepth(sources: readonly RankArray[], layer: number): number {
    let depth = 0;
    for (const source of sources) depth = Math.max(depth, lazyDepth.get(source) ?? 0);
    depth += layer;
    if (depth > MAX_LAZY_ARRAY_DEPTH) {
        throw new RankError('lazy array chain exceeds 8192 reader layers; use copy to materialize an intermediate array', 'ResourceLimit');
    }
    return depth;
}

class OwnedEntries extends Map<string, RankValue> {
    revision = writeRevision;
    readonly birth = nextCreationSerial();
    readonly resources = new ResourceSummary();
    private scalarOnly = true;
    private readonly stored = new StoredValueSummary(() => this.scalarOnly);

    constructor(entries: Iterable<readonly [string, RankValue]>) {
        super();
        this.stored.track(this);
        for (const [key, value] of entries) {
            this.resources.include(value);
            this.stored.include(value);
            this.scalarOnly &&= typeof value !== 'object';
            Map.prototype.set.call(this, key, value);
        }
    }

    override set(key: string, value: RankValue): this {
        this.resources.include(value);
        this.stored.include(value);
        this.scalarOnly &&= typeof value !== 'object';
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
        epoch: -1, values: () => map.values(), own: () => map.revision,
    });
    return map.resources.track(object);
}

/** A shared dependency/ownership node with no cell reader or cell cache. Keeping
 * these nodes lets concat release obsolete readers while retaining source proofs. */
export function arrayDependencyNode(sources: readonly RankArray[]): RankArray {
    const node: RankArray = { kind: 'array', shape: [0], items: [] };
    derivedRevisions.set(node, { epoch: -1, values: () => sources, sources });
    lazyDepth.set(node, arrayReaderDepth(sources, 0));
    return node;
}

/** Publish dependencies for a pure producer with a dynamically inferred shape. */
export function registerArrayDependencies<T extends RankArray>(value: T, sources: readonly RankArray[]): T {
    const depth = arrayReaderDepth(sources, 1);
    derivedRevisions.set(value, { epoch: -1, values: () => sources });
    lazyDepth.set(value, depth);
    return value;
}
