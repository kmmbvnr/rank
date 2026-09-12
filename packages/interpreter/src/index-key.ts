import { RankError } from './errors.js';
import { setValueKey } from './set.js';
import { isRankDate, isRankLabel, type RankValue } from './value.js';

/** Stable key for one or more scalar index selectors. */
export function indexKey(values: readonly RankValue[]): string {
    if (values.length === 0) throw new RankError('index requires at least one key');
    return JSON.stringify(values.map(value => {
        if (typeof value === 'bigint' || typeof value === 'number'
            || typeof value === 'boolean' || typeof value === 'string'
            || isRankLabel(value) || isRankDate(value)) return setValueKey(value);
        throw new RankError('index keys must be scalar values');
    }));
}
