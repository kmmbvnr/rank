import { noteArrayBinding } from './array-storage.js';
import { ownedStorage } from './runtime/array-storage-state.js';
import type { RankValue } from './value.js';
import { StoredValueSummary } from './stored-value.js';

// A possible resource insertion invalidates earlier proofs, including proofs held
// by parents of an aliased container. No parent links or deep mutation scans.
let mutationEpoch = 0;
const summaries = new WeakMap<object, ResourceSummary>();

export function isKnownFileFree(value: RankValue | undefined): boolean {
    if (value === undefined || typeof value !== 'object') return true;
    if (value.kind === 'bytes' || value.kind === 'label'
        || value.kind === 'date' || value.kind === 'datetime') return true;
    const summary = summaries.get(value);
    if (summary) return summary.fileFree;
    // Arrays keep their summary in their storage state, created on demand.
    const owned = value.kind === 'array' ? ownedStorage.get(value) : undefined;
    return owned !== undefined && (owned.resources?.fileFree ?? (owned.scalarOnly && owned.stable));
}

export class ResourceSummary {
    private readonly epoch = mutationEpoch;
    private uncertain = false;

    constructor(private readonly independentProof?: () => boolean) {}

    get fileFree(): boolean {
        return this.independentProof?.() === true || !this.uncertain && this.epoch === mutationEpoch;
    }

    track<const T extends object>(value: T): T {
        summaries.set(value, this);
        return value;
    }

    include(value: RankValue): void {
        if (isKnownFileFree(value)) return;
        this.invalidate();
    }

    invalidate(): void {
        if (this.fileFree) mutationEpoch += 1;
        this.uncertain = true;
    }
}

/** Public Map writes must invalidate proofs too, including writes made by JS. */
export class ResourceMap<T, K = string> extends Map<K, T> {
    readonly resources = new ResourceSummary();
    private scalarOnly = true;
    private readonly stored = new StoredValueSummary(() => this.scalarOnly);

    constructor(private readonly valueOfEntry: (entry: T) => RankValue) {
        super();
        this.stored.track(this);
    }

    override set(key: K, value: T): this {
        const entry = this.valueOfEntry(value);
        this.stored.include(entry);
        this.scalarOnly &&= typeof entry !== 'object';
        this.resources.include(entry);
        noteArrayBinding(entry);
        return super.set(key, value);
    }
}
