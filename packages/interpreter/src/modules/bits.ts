import { RankError } from '../errors.js';
import { expectInteger, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const bitsModule: RuntimeModule = {
    band: () => binary('band', (left, right) => left & right),
    bor: () => binary('bor', (left, right) => left | right),
    bxor: () => binary('bxor', (left, right) => left ^ right),
    bnot: () => native('bnot', 1, arguments_ => ~expectInteger(arguments_[0]), 0),
    shl: () => binary('shl', (left, right) => left << shiftCount(right)),
    shr: () => binary('shr', (left, right) => left >> shiftCount(right)),
    bit: () => native('bit', 2, arguments_ => {
        const value = nonnegative('bit', expectInteger(arguments_[0]));
        const position = shiftCount(expectInteger(arguments_[1]));
        return (value & (1n << position)) !== 0n;
    }),
    popcount: () => native('popcount', 1, arguments_ => {
        let value = nonnegative('popcount', expectInteger(arguments_[0]));
        let count = 0n;
        while (value !== 0n) {
            value &= value - 1n;
            count += 1n;
        }
        return count;
    }, 0),
};

function binary(name: string, operation: (left: bigint, right: bigint) => bigint) {
    return native(name, 2, arguments_ =>
        operation(expectInteger(arguments_[0]), expectInteger(arguments_[1])));
}

function shiftCount(value: bigint): bigint {
    if (value < 0n) throw new RankError('shift count must be nonnegative');
    return value;
}

function nonnegative(operation: string, value: bigint): bigint {
    if (value < 0n) throw new RankError(`${operation} expects a nonnegative integer`);
    return value;
}
