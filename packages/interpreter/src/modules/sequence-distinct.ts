import { numericDistinct } from '../numeric-collections.js';
import { collectionSize } from '../collection-size.js';
import { RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import { ownedArray } from '../array-storage.js';
import { orderedSource } from '../ordered-source.js';
import { stackItems } from '../sequence.js';
import { setValueKey } from '../set.js';
import { isRankArray, isRankSequence, isRankSqliteTable, tuple, type RankValue } from '../value.js';
import { materializeSqlite } from './sqlite.js';

/** Retain first occurrences and their frequencies in one traversal. */
export function uniqueCounts(value: RankValue): RankValue {
    if (isRankSqliteTable(value)) value = materializeSqlite(value);
    if (isRankSequence(value) && value.plan.size.kind === 'infinite') {
        throw new RankError('unique .counts requires a finite sequence', 'TypeError');
    }
    const source = orderedSource(value, 'unique', 'unique');
    if (!source) throw new RankError('unique .counts expects text or a collection', 'TypeError');
    const keyOf = source.key ?? setValueKey;
    const positions = new Map<string, number>();
    const values: RankValue[] = [];
    const counts: bigint[] = [];
    for (const item of source.values()) {
        checkpoint('counting distinct values');
        const key = keyOf(item);
        const position = positions.get(key);
        if (position === undefined) {
            positions.set(key, values.length);
            values.push(item);
            counts.push(1n);
        } else counts[position] += 1n;
    }
    const distinct = stackItems(values, undefined, 'collection');
    if (isRankArray(value) && value.columnNames) {
        Object.defineProperty(distinct, 'columnNames', { value: value.columnNames });
    }
    return tuple([distinct, ownedArray(counts)]);
}

/** Count distinct keys without building the collection produced by unique. */
export function uniqueLength(value: RankValue): bigint | undefined {
    // Joining distinct code points can form new surrogate pairs in text.
    if (typeof value === 'string') return undefined;
    // Higher-rank arrays use unique's intrinsic rank to process each row.
    if (isRankArray(value) && value.shape.length > 1) return undefined;
    // SQLite has its own unique/len query path.
    if (isRankSqliteTable(value)) return undefined;
    if (isRankSequence(value) && value.plan.size.kind === 'infinite') return undefined;
    const fast = numericDistinct(value, true);
    if (typeof fast === 'bigint') return fast;
    const source = orderedSource(value, 'unique', 'unique');
    if (!source) return undefined;
    if (source.alreadyDistinct) return collectionSize(value)!.length();
    const values = source.values();
    const keyOf = source.key ?? setValueKey;
    const seen = new Set<string>();
    let count = 0n;
    for (const item of values) {
        checkpoint('counting distinct values');
        const key = keyOf(item);
        if (seen.has(key)) continue;
        seen.add(key);
        count += 1n;
    }
    return count;
}

export function uniqueValue(value: RankValue): RankValue {
    const fast = numericDistinct(value);
    if (fast !== undefined) return fast;
    const source = orderedSource(value, 'unique', 'unique');
    if (!source) throw new RankError('unique expects text or a collection');
    if (source.alreadyDistinct) return value;
    const values = source.values();
    const keyOf = source.key ?? setValueKey;
    const distinct = { *[Symbol.iterator]() {
        const seen = new Set<string>();
        for (const item of values) {
            const key = keyOf(item);
            if (seen.has(key)) continue;
            seen.add(key);
            yield item;
        }
    } };
    return source.build(distinct);
}

