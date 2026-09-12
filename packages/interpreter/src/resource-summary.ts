import type { RankValue } from './value.js';

// A possible resource insertion invalidates earlier proofs, including proofs held
// by parents of an aliased container. No parent links or deep mutation scans.
let mutationEpoch = 0;
const summaries = new WeakMap<object, ResourceSummary>();

export function isKnownFileFree(value: RankValue | undefined): boolean {
    if (value === undefined || typeof value !== 'object') return true;
    if (value.kind === 'bytes' || value.kind === 'label') return true;
    return summaries.get(value)?.fileFree === true;
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
export class ResourceMap<T> extends Map<string, T> {
    readonly resources = new ResourceSummary();

    constructor(private readonly valueOfEntry: (entry: T) => RankValue) { super(); }

    override set(key: string, value: T): this {
        this.resources.include(this.valueOfEntry(value));
        return super.set(key, value);
    }
}
