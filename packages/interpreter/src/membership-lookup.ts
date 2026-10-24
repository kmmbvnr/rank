import { type RankArray, type RankValue } from './value.js';
import { readArrayItem } from './array-storage.js';
import { equalMembershipValues } from './value-comparison.js';
import { checkpoint } from './interrupt.js';
import { membershipKeys } from './membership-keys.js';

// Hash scalar values once; retain structural equality for composite values.
export function membershipLookup(values: Iterable<RankValue> | RankArray, maxSize?: number): (value: RankValue) => boolean {
    const size = 'shape' in values ? values.shape.reduce((size, dimension) => size * dimension, 1) : maxSize;
    const scalars = membershipKeys<RankValue>(size);
    const composite: RankValue[] = [];
    const key = (value: RankValue): RankValue => typeof value === 'number'
        && Number.isFinite(value) && Number.isInteger(value) ? BigInt(value) : value;
    const add = (value: RankValue): void => {
        checkpoint('indexing membership');
        if (typeof value === 'object') composite.push(value);
        else if (!(typeof value === 'number' && Number.isNaN(value))) scalars.add(key(value));
    };
    if ('shape' in values) {
        // Index arrays directly without wrapping each cell in reduction iterators.
        for (let index = 0; index < size!; index++) add(readArrayItem(values, index));
    } else {
        for (const value of values) add(value);
    }
    return value => typeof value === 'object'
        ? composite.some(item => equalMembershipValues(value, item))
        : scalars.has(key(value));
}
