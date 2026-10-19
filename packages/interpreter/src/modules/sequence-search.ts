import { numericFind } from '../numeric-search.js';
import { ownedArray, readArrayItem } from '../array-storage.js';
import { RankError, MissingValueError } from '../errors.js';
import { setValueKey } from '../set.js';
import { isRankArray, type RankArray, type RankValue } from '../value.js';

export function findValue(source: RankValue, target: RankValue): bigint {
    const fast = numericFind(source, target);
    if (fast !== undefined) return fast;
    const values = findSource(source, 'find');
    const targetKey = setValueKey(target);
    let index = 0n;
    for (const value of values) {
        if (setValueKey(value) === targetKey) return index;
        index += 1n;
    }
    throw new MissingValueError('find found no matching value');
}

export function findAllValues(source: RankValue, target: RankValue): RankArray {
    const values = findSource(source, 'findall');
    const targetKey = setValueKey(target);
    const positions: bigint[] = [];
    let index = 0n;
    for (const value of values) {
        if (setValueKey(value) === targetKey) positions.push(index);
        index += 1n;
    }
    return ownedArray(positions, [positions.length]);
}

function* findSource(source: RankValue, operation: string): IterableIterator<RankValue> {
    if (typeof source === 'string') {
        yield* source;
        return;
    }
    if (!isRankArray(source) || source.shape.length !== 1) {
        throw new RankError(`${operation} expects text or a rank-1 array`, 'TypeError');
    }
    for (let index = 0; index < source.shape[0]; index += 1) yield readArrayItem(source, index);
}

