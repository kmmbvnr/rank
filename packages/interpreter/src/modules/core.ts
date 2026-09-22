import { RankError } from '../errors.js';
import { ByteArray } from '../bytes.js';
import { withTypedCalls } from '../typed-native.js';
import { readArrayItem } from '../array-storage.js';
import { formatValue, isRankArray, isRankBytes, isRankDate, isRankLabel, type RankValue } from '../value.js';
import { numericExtreme, sumValue } from './numbers.js';
import { lengthOf } from './sequences.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

const encoder = new TextEncoder();

/** Ordinary functions available in every workspace without a use statement. */
export const coreModule: RuntimeModule = {
    bytes: () => withTypedCalls(native('bytes', 1, ([value]) => {
        if (isRankBytes(value)) return value;
        if (typeof value === 'string') return new ByteArray(encoder.encode(value));
        if (!isRankArray(value) || value.shape.length !== 1) {
            throw new RankError('bytes expects text or a rank-1 integer array', 'TypeError');
        }
        const data = new Uint8Array(value.shape[0]);
        for (let index = 0; index < data.length; index += 1) {
            const item = readArrayItem(value, index);
            if (typeof item !== 'bigint') {
                throw new RankError('bytes expects integer elements', 'TypeError');
            }
            if (item < 0n || item > 255n) {
                throw new RankError('byte must be between 0 and 255', 'DomainError');
            }
            data[index] = Number(item);
        }
        return new ByteArray(data);
    }), {
        text: arguments_ => new ByteArray(encoder.encode(arguments_[0] as string)),
        bytes: arguments_ => arguments_[0],
    }),
    integer: () => native('integer', 1, ([value]) => integerValue(value), 1),
    real: () => native('real', 1, ([value]) => realValue(value), 1),
    text: () => native('text', 1, ([value]) => {
        if (typeof value === 'object' && !isRankLabel(value) && !isRankDate(value)) {
            throw new RankError('text expects a scalar value', 'TypeError');
        }
        return formatValue(value);
    }),
    len: () => native('len', 1, args => lengthOf(args[0])),
    sum: () => native('sum', 1, args => sumValue(args[0])),
    min: () => numericExtreme('min', (left, right) => left < right),
    max: () => numericExtreme('max', (left, right) => left > right),
};

function integerValue(value: RankValue): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new RankError('integer expects a finite real', 'InvalidNumber', value);
        }
        return BigInt(Math.trunc(value));
    }
    if (typeof value !== 'string') {
        throw new RankError('integer expects an integer, real or text', 'TypeError');
    }
    if (!/^[+-]?[0-9]+$/.test(value)) {
        throw new RankError(`invalid integer text: ${value}`, 'InvalidNumber', value);
    }
    return BigInt(value);
}

function realValue(value: RankValue): number {
    if (typeof value === 'number') return value;
    if (typeof value !== 'bigint' && typeof value !== 'string') {
        throw new RankError('real expects an integer, real or text', 'TypeError');
    }
    if (typeof value === 'string' && !/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(value)) {
        throw new RankError(`invalid real text: ${value}`, 'InvalidNumber', value);
    }
    const result = Number(value);
    if (!Number.isFinite(result)) {
        throw new RankError('real conversion exceeds the finite range', 'InvalidNumber', value);
    }
    return result;
}
