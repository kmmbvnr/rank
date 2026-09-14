import { RankError } from '../errors.js';
import { formatValue, isRankDate, isRankLabel, type RankValue } from '../value.js';
import { numericExtreme, sumValue } from './numbers.js';
import { lengthOf } from './sequences.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

/** Ordinary functions available in every workspace without a use statement. */
export const coreModule: RuntimeModule = {
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
