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
