import { ownedArray } from '../array-storage.js';
import { RankError } from '../errors.js';
import { mapSequence } from '../sequence.js';
import {
    isRankArray,
    isRankSequence,
    type IntrinsicRank,
    type NativeFunction,
    type RankArray,
    type RankValue,
} from '../value.js';

export function native(
    name: string,
    arity: number | readonly number[],
    call: (arguments_: RankValue[]) => RankValue,
    monadicRank: IntrinsicRank = 'all',
    dyadicRanks?: readonly [IntrinsicRank, IntrinsicRank],
    monadicResultShape?: (cellShape: readonly number[]) => readonly number[],
): NativeFunction {
    const arities = typeof arity === 'number' ? [arity] : arity;
    return {
        kind: 'function',
        name,
        arities,
        monadicRank,
        monadicResultShape,
        dyadicRanks,
        call(arguments_) {
            if (!arities.includes(arguments_.length)) {
                throw new RankError(
                    `${name} expects ${arities.join(' or ')} argument, got ${arguments_.length}`,
                );
            }
            return call(arguments_);
        },
    };
}

export function mapValue(
    value: RankValue,
    operation: (scalar: RankValue) => RankValue,
): RankValue {
    if (isRankSequence(value)) return mapSequence(value, 'map', operation);
    return isRankArray(value) ? array(value.items.map(operation)) : operation(value);
}

export function expectInteger(value: RankValue): bigint {
    if (typeof value !== 'bigint') {
        throw new RankError(`expected integer input`);
    }
    return value;
}

export function expectNumeric(value: RankValue): bigint | number {
    if (typeof value !== 'bigint' && typeof value !== 'number') {
        throw new RankError('expected numeric input');
    }
    return value;
}

function array(items: RankValue[]): RankArray {
    return ownedArray(items);
}
