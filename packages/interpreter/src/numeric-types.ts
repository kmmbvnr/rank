import { RankError } from './errors.js';
import type { RankValue } from './value.js';

/** Numeric operations never choose a conversion for the user. */
export function requireSameNumericType(left: RankValue, right: RankValue): void {
    if ((typeof left === 'bigint' && typeof right === 'number')
        || (typeof left === 'number' && typeof right === 'bigint')) {
        throw new RankError('integer and real require explicit conversion with integer or real', 'TypeError');
    }
}
