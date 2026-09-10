import { RankError } from '../errors.js';
import { expectInteger, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const bitsModule: RuntimeModule = {
    band: () => binaryOperation('band', (left, right) => left & right),
    bor: () => binaryOperation('bor', (left, right) => left | right),
    bxor: () => binaryOperation('bxor', (left, right) => left ^ right),
    bnot: () => native('bnot', 1, arguments_ => ~expectInteger(arguments_[0]), 0),
    shl: () => binaryOperation('shl', (left, right) => left << shiftCount(right)),
    shr: () => binaryOperation('shr', (left, right) => left >> shiftCount(right)),
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
    binary: () => native('binary', [1, 2], arguments_ => {
        const value = nonnegative('binary', expectInteger(arguments_[0]));
        const digits = value.toString(2);
        if (arguments_.length === 1) return digits;

        const width = expectInteger(arguments_[1]);
        if (width <= 0n || width > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError('binary width must be a positive safe integer');
        }
        if (BigInt(digits.length) > width) {
            throw new RankError(`binary value does not fit width ${width}`);
        }
        return digits.padStart(Number(width), '0');
    }, 0),
};

function binaryOperation(name: string, operation: (left: bigint, right: bigint) => bigint) {
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
