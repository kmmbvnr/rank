import { RankError } from './errors.js';
import type { RankValue } from './value.js';

export function integerValue(value: RankValue): bigint {
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

export function realValue(value: RankValue): number {
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
