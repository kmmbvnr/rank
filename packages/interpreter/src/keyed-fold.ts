import { ownedArray, readArrayItem } from './array-storage.js';
import { RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { sameShape } from './tensor-index.js';
import { isRankArray, type RankArray, type RankValue } from './value.js';

export interface KeyedFoldOptions {
    readonly scan?: boolean;
    readonly seed?: RankValue;
    readonly identity?: () => RankValue;
}

/** Maintain independent accumulators in source traversal order. */
export function keyedFold(values: RankValue, keys: RankValue,
    combine: (left: RankValue, right: RankValue) => RankValue,
    options: KeyedFoldOptions = {},
): RankArray {
    if (!isRankArray(values) || !isRankArray(keys)) {
        throw new RankError('by expects values and keys arrays', 'TypeError');
    }
    if (!sameShape(values.shape, keys.shape)) {
        throw new RankError('by keys must match the values shape', 'DimensionMismatch');
    }
    const { seed, identity, scan } = options;
    const count = values.shape.reduce((a, b) => a * b, 1);
    const states: RankValue[] = [];
    const output: RankValue[] = [];
    let length = 0;
    for (let index = 0; index < count; index++) {
        checkpoint('keyed fold');
        const key = readArrayItem(keys, index);
        if (typeof key !== 'bigint' || key < 0n || key >= 0xffffffffn) {
            throw new RankError('by keys must be nonnegative integer array indices', 'TypeError');
        }
        const at = Number(key);
        length = Math.max(length, at + 1);
        const value = readArrayItem(values, index);
        const previous = states[at];
        states[at] = previous !== undefined ? combine(previous, value)
            : seed !== undefined ? combine(seed, value) : value;
        if (scan) output.push(states[at]);
    }
    if (scan) return ownedArray(output, values.shape);
    for (let at = 0; at < length; at++) {
        checkpoint('keyed fold');
        if (states[at] !== undefined) continue;
        if (seed !== undefined) states[at] = seed;
        else if (identity) states[at] = identity();
        else throw new RankError('empty keyed group requires an initial value', 'MissingValueError');
    }
    return ownedArray(states);
}
