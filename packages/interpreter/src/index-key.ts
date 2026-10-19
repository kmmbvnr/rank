import { RankError } from './errors.js';
import { setValueKey } from './set.js';
import { isRankDate, isRankLabel, type RankValue } from './value.js';

export type IndexKey = string | number | bigint;

/** Stable key for one or more scalar index selectors. */
export function indexKey(values: readonly RankValue[]): IndexKey {
    if (values.length === 1) {
        const value = values[0];
        // Canonicalize integer reals and BigInts exactly as setValueKey does.
        // Safe integers share a Number key; larger integers stay exact BigInts.
        if (typeof value === 'bigint') {
            const number = Number(value);
            return Number.isSafeInteger(number) ? number : value;
        }
        if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
            return Number.isSafeInteger(value) ? value : BigInt(value);
        }
    }
    if (values.length === 0) throw new RankError('index requires at least one key');
    return JSON.stringify(values.map(value => {
        if (typeof value === 'bigint' || typeof value === 'number'
            || typeof value === 'boolean' || typeof value === 'string'
            || isRankLabel(value) || isRankDate(value)) return setValueKey(value);
        throw new RankError('index keys must be scalar values');
    }));
}
