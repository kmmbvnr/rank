import { numericDistinct } from '../numeric-collections.js';
import { collectionSize } from '../collection-size.js';
import { RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import { orderedSource } from '../ordered-source.js';
import { setValueKey } from '../set.js';
import { isRankArray, isRankSequence, isRankSqliteTable, type RankValue } from '../value.js';

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

