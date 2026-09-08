import { RankError } from '../errors.js';
import { mapSequence } from '../sequence.js';
import { isRankArray, isRankSequence, type NativeFunction, type RankArray, type RankValue } from '../value.js';

export function native(
    name: string,
    arity: number | readonly number[],
    call: (arguments_: RankValue[]) => RankValue,
): NativeFunction {
    const arities = typeof arity === 'number' ? [arity] : arity;
    return {
        kind: 'function',
        name,
        arities,
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

function array(items: RankValue[]): RankArray {
    return { kind: 'array', items, shape: [items.length] };
}
