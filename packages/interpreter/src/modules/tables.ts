import { MissingValueError, RankError } from '../errors.js';
import {
    isRankObject,
    type RankArray,
    type RankValue,
} from '../value.js';
import type { RuntimeModule } from './types.js';

export const tablesModule: RuntimeModule = {};

/** Lazily project one named field from every object cell in an array. */
export function projectField(source: RankArray, field: string): RankArray {
    const cache = new Map<number, RankValue>();
    const itemAt = (position: number): RankValue => {
        const cached = cache.get(position);
        if (cached !== undefined) return cached;
        const row = source.itemAt?.(position) ?? source.items[position];
        if (!isRankObject(row)) {
            throw new RankError('table projection expects object rows', 'TypeError');
        }
        const value = row.entries.get(field);
        if (value === undefined) {
            throw new MissingValueError(`missing object key: ${field}`);
        }
        cache.set(position, value);
        return value;
    };
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape: source.shape,
        itemAt,
        containsFiles: false,
        get items() {
            const size = source.shape.reduce(
                (product, dimension) => product * dimension,
                1,
            );
            materialized ??= Array.from(
                { length: size },
                (_, position) => itemAt(position),
            );
            return materialized;
        },
    };
}
