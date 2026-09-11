import { RankError } from './errors.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

/** Eager numeric cells only. Lazy Rank readers must retain their caches. */
export function eagerArrayStorage(value: RankValue): {
    shape: readonly number[]; read: (index: number) => RankValue;
} | undefined {
    if (!isRankArray(value) || 'itemAt' in value) return undefined;
    const items = Object.getOwnPropertyDescriptor(value, 'items')?.value;
    if (!Array.isArray(items)
        || !items.every(item => typeof item === 'number' || typeof item === 'bigint' || typeof item === 'boolean')) {
        return undefined;
    }
    return { shape: value.shape, read: index => items[index] };
}

/** A shallow copy for our JS callers, not an immutability or isolation boundary. */
export function createArraySnapshot(items: Iterable<RankValue>, shape?: readonly number[]): RankArray {
    const copied = Array.from(items);
    const dimensions = shape === undefined ? [copied.length] : [...shape];
    if (dimensions.some(size => !Number.isSafeInteger(size) || size < 0)
        || dimensions.reduce((size, dimension) => size * BigInt(dimension), 1n) !== BigInt(copied.length)) {
        throw new RankError('array snapshot shape does not match its items', 'DimensionMismatch');
    }
    return { kind: 'array', items: copied, shape: dimensions };
}


// Only runtime-owned readers may publish a stable, already-computed cache.
// Looking up storage must never evaluate a lazy element or call user code.
const cachedStorage = new WeakMap<RankArray, () => RankValue[] | undefined>();

export function registerCachedArray<T extends RankArray>(
    value: T, peek: () => RankValue[] | undefined,
): T {
    cachedStorage.set(value, peek);
    return value;
}

export function materializedArrayItems(value: RankArray): RankValue[] | undefined {
    if ('itemAt' in value) return cachedStorage.get(value)?.();
    const items = Object.getOwnPropertyDescriptor(value, 'items')?.value;
    return Array.isArray(items) ? items : undefined;
}
