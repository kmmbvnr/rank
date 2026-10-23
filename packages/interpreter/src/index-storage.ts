import { checkValueMutable } from './value-protection.js';
import { currentDiagnostics } from './diagnostics.js';
import type { IndexKey } from './index-key.js';
import type { RankIndex, RankValue } from './value.js';
import { IntegerEntries } from './integer-entries.js';
import { MissingValueError } from './errors.js';

// Selector validation/encoding is separate from access: assignments prepare the
// key before evaluating their RHS, while compiled regions may reuse that key.
export { indexKey, type IndexKey } from './index-key.js';

export class IndexEntries extends IntegerEntries<IndexKey> {}

export function indexRead(index: RankIndex, key: IndexKey, missing = 'missing keyed value'): RankValue {
    const value = indexGet(index, key);
    if (value === undefined) throw new MissingValueError(missing);
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
    checkValueMutable(index);
    index.entries.set(key, value);
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.indexWrites++;
}
