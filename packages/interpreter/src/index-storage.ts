import { currentDiagnostics } from './diagnostics.js';
import type { IndexKey } from './index-key.js';
import type { RankIndex, RankValue } from './value.js';
import { ResourceMap } from './resource-summary.js';
import { MissingValueError } from './errors.js';

// Selector validation/encoding is separate from access: assignments prepare the
// key before evaluating their RHS, while compiled regions may reuse that key.
export { indexKey, type IndexKey } from './index-key.js';

/** Maintain the integer-domain proof on every public Map mutation. Compiled
 * readers can enter repeatedly without rescanning the entire index. */
export class IndexEntries extends ResourceMap<RankValue, IndexKey> {
    private nonIntegers = 0;

    constructor() { super(value => value); }

    get integers(): boolean { return this.nonIntegers === 0; }

    override set(key: IndexKey, value: RankValue): this {
        if (this.has(key) && typeof this.get(key) !== 'bigint') this.nonIntegers--;
        if (typeof value !== 'bigint') this.nonIntegers++;
        return super.set(key, value);
    }

    override delete(key: IndexKey): boolean {
        if (this.has(key) && typeof this.get(key) !== 'bigint') this.nonIntegers--;
        return super.delete(key);
    }

    override clear(): void {
        super.clear();
        this.nonIntegers = 0;
    }
}

export function indexRead(index: RankIndex, key: IndexKey): RankValue {
    const value = indexGet(index, key);
    if (value === undefined) throw new MissingValueError('missing keyed value');
    return value;
}

export function indexGet(index: RankIndex, key: IndexKey): RankValue | undefined {
    const value = index.entries.get(key), diagnostics = currentDiagnostics();
    if (diagnostics) {
        diagnostics.indexReads++;
        if (value === undefined) diagnostics.indexReadMisses++;
        else diagnostics.indexReadHits++;
    }
    return value;
}

export function indexHas(index: RankIndex, key: IndexKey): boolean {
    return index.entries.has(key);
}

export function indexSet(index: RankIndex, key: IndexKey, value: RankValue): void {
    index.entries.set(key, value);
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.indexWrites++;
}
