import { indexKey } from './index-key.js';
import type { RankIndex, RankValue } from './value.js';

// Selector validation/encoding is separate from access: assignments prepare the
// key before evaluating their RHS, while compiled regions may reuse that key.
export type IndexKey = ReturnType<typeof indexKey>;
export { indexKey };

export function indexGet(index: RankIndex, key: IndexKey): RankValue | undefined {
    return index.entries.get(key);
}

export function indexHas(index: RankIndex, key: IndexKey): boolean {
    return index.entries.has(key);
}

export function indexSet(index: RankIndex, key: IndexKey, value: RankValue): void {
    index.entries.set(key, value);
}
