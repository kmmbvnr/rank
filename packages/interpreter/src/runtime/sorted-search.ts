import { readArrayItem } from './array-storage.js';
import { RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import { isRankArray, type RankValue } from './value.js';

/** The caller supplies an ascending integer vector. Inspect only the binary
 * search path: validating sortedness on each call would make queries linear. */
export function sortedIndex(source: RankValue, target: RankValue, upper: boolean): bigint {
    const name = upper ? 'upperindex' : 'lowerindex';
    if (!isRankArray(source) || source.shape.length !== 1) {
        throw new RankError(`${name} expects a sorted integer vector`);
    }
    if (typeof target !== 'bigint') throw new RankError(`${name} expects an integer target`);
    let low = 0, high = source.shape[0];
    while (low < high) {
        checkpoint('searching sorted integers');
        const middle = Math.floor((low + high) / 2);
        const value = readArrayItem(source, middle);
        if (typeof value !== 'bigint') throw new RankError(`${name} expects a sorted integer vector`);
        if (value < target || upper && value === target) low = middle + 1;
        else high = middle;
    }
    return BigInt(low);
}
