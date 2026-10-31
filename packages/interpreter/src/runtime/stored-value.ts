import { denseScalarItems } from './array-storage.js';
import { ownedStorage } from './array-storage-state.js';
import type { RankArray, RankValue, SequencePlan } from './value.js';

// Native finite sources backed entirely by immutable storage need no expansion
// at a binding boundary. Freezing the plan keeps this constructor proof valid.
const storedSequences = new WeakSet<SequencePlan>();
export function registerStoredSequence(plan: SequencePlan): void {
    storedSequences.add(Object.freeze(plan));
}

let mutationEpoch = 0;
const summaries = new WeakMap<object, StoredValueSummary>();

function ownedComplete(value: RankArray): boolean {
    const owned = ownedStorage.get(value);
    if (!owned) return false;
    return owned.stored?.complete ?? (owned.stable && (owned.scalarOnly || owned.validity !== undefined));
}

/** Storage evidence only: this lookup never evaluates a plan or reads cells. */
export function isStoredValue(value: RankValue): boolean {
    if (typeof value !== 'object') return true;
    switch (value.kind) {
        case 'sequence': return storedSequences.has(value.plan);
        case 'plan': case 'sqlite-table': case 'sqlite-expression': case 'sqlite-scope': return false;
        case 'array': return denseScalarItems(value) !== undefined || summaries.get(value)?.complete === true || ownedComplete(value);
        case 'tuple': case 'queue': case 'heap': case 'multiset': case 'table': case 'grouped-table':
            return summaries.get(value)?.complete === true;
        case 'table-alias': return isStoredValue(value.source);
        case 'record': case 'object': case 'index': case 'set': case 'counter':
            return summaries.get(value.entries)?.complete === true;
        default: return true;
    }
}

/** A possible deferred insertion invalidates ancestor proofs. This retains no
 * computed results or parent links; untracked host containers have no proof. */
export class StoredValueSummary {
    private readonly epoch = mutationEpoch;
    private uncertain = false;

    constructor(private readonly independentProof?: () => boolean) {}

    get complete(): boolean {
        return this.independentProof?.() === true || !this.uncertain && this.epoch === mutationEpoch;
    }

    track<T extends object>(value: T): T { summaries.set(value, this); return value; }

    include(value: RankValue): void {
        if (!isStoredValue(value)) this.invalidate();
    }

    invalidate(): void {
        // Ancestors may have used an independent proof even if our epoch is old.
        mutationEpoch++;
        this.uncertain = true;
    }
}
