import { arrayRevision, denseScalarItems, materializedArrayItems, typedElementKind } from './array-storage.js';
import { typeName, type RankArray, type RankValue } from './value.js';

/** Inspect only already stored cells, without running lazy readers or host getters. */
const numericLimitCache = new WeakMap<RankArray, { revision: number; types: string[] }>();
const elementTypeCache = new WeakMap<RankArray, { revision: number; types: string[] }>();

export function arrayElementTypes(value: RankArray, numericLimits = false): string[] | undefined {
    if (value.kind === 'bytes') return value.shape.some(size => size === 0) ? [] : ['integer'];
    const cache = numericLimits ? numericLimitCache : elementTypeCache;
    const name = (item: RankValue): string => numericLimits && typeof item === 'number'
        && !Number.isFinite(item) && !Number.isNaN(item) ? 'numeric-limit' : typeName(item);
    const revision = arrayRevision(value);
    const cached = cache.get(value);
    if (revision !== undefined && cached?.revision === revision) return cached.types;
    const typed = typedElementKind(value);
    if (typed && !(typed === 'real' && numericLimits)) return [typed];
    const dense = denseScalarItems(value);
    if (dense) {
        // Stored scalars cannot hide getters, so no descriptor lookup is needed.
        const types = new Set<string>();
        let last: string | undefined;
        for (let index = 0; index < dense.length; index++) {
            const item = dense[index];
            const type = typeof item === 'bigint' ? 'integer' : name(item);
            if (type !== last) { types.add(type); last = type; }
        }
        const result = [...types].sort();
        if (revision !== undefined) cache.set(value, { revision, types: result });
        return result;
    }
    const items = materializedArrayItems(value);
    if (!items) return undefined;
    // Property descriptors avoid invoking getters on host-supplied cells.
    const types = new Set<string>();
    for (let index = 0; index < items.length; index++) {
        const property = Object.getOwnPropertyDescriptor(items, index);
        if (!property || !('value' in property)) return undefined;
        types.add(name(property.value));
    }
    const result = [...types].sort();
    if (revision !== undefined) cache.set(value, { revision, types: result });
    return result;
}

