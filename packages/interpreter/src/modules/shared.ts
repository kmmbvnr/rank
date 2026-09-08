import { RankError } from '../errors.js';
import { mapSequence } from '../sequence.js';
import { isRankArray, isRankSequence, type NativeFunction, type RankArray, type RankValue } from '../value.js';

export function native(
    name: string,
    arity: number,
    call: (arguments_: RankValue[]) => RankValue,
): NativeFunction {
    return {
        kind: 'function',
        name,
        call(arguments_) {
            if (arguments_.length !== arity) {
                throw new RankError(`${name} expects ${arity} argument, got ${arguments_.length}`);
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
