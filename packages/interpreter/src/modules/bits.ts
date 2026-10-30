import { withTypedCalls } from '../typed-native.js';
import { checkpoint } from '../interrupt.js';
import { RankError } from '../errors.js';
import { expectInteger, native, scalarNative } from './shared.js';
import { mapStoredUnary } from '../unary-array-kernel.js';
import type { RuntimeModule } from './types.js';

const nibbleCounts = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export const bitsModule: RuntimeModule = {
    band: () => binaryOperation('band', (left, right) => left & right),
    bor: () => binaryOperation('bor', (left, right) => left | right),
    bxor: () => binaryOperation('bxor', (left, right) => left ^ right),
    bnot: () => native('bnot', 1, arguments_ => ~expectInteger(arguments_[0])),
    shl: () => binaryOperation('shl', (left, right) => left << shiftCount(right)),
    shr: () => binaryOperation('shr', (left, right) => left >> shiftCount(right)),
    bit: () => native('bit', 2, arguments_ => {
        const value = nonnegative('bit', expectInteger(arguments_[0]));
        const position = shiftCount(expectInteger(arguments_[1]));
        return (value & (1n << position)) !== 0n;
    }),
    popcount: () => scalarNative('popcount', argument => {
        let value = nonnegative('popcount', expectInteger(argument));
        // A fixed bound keeps tiny/sparse values cheap without a quadratic tail.
        let count = 0;
        for (; count < 4 && value !== 0n; count++) value &= value - 1n;
        if (value === 0n) return BigInt(count);
        const digits = value.toString(16);
        for (let i = 0; i < digits.length; i++) {
            if ((i & 0xfff) === 0) checkpoint('popcount', 4096);
            const code = digits.charCodeAt(i);
            count += nibbleCounts[code >= 97 ? code - 87 : code - 48];
        }
        return BigInt(count);
    }, source => mapStoredUnary(source, 'integer', value => {
        if (value < 0) throw new RankError('popcount expects a nonnegative integer');
        return bitCount(value);
    }, 'integer'), 'integer'),
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
    }),
};

function binaryOperation(name: string, operation: (left: bigint, right: bigint) => bigint) {
    return withTypedCalls(native(name, 2, arguments_ =>
        operation(expectInteger(arguments_[0]), expectInteger(arguments_[1]))), {
        'integer,integer': arguments_ => operation(arguments_[0] as bigint, arguments_[1] as bigint),
    });
}

/** Set bits of a nonnegative safe integer, counted in 32-bit halves. */
function bitCount(value: number): number {
    let count = 0;
    for (let half = value % 4294967296 | 0, i = 0; i < 2; i++, half = Math.floor(value / 4294967296) | 0) {
        half -= half >>> 1 & 0x55555555;
        half = (half & 0x33333333) + (half >>> 2 & 0x33333333);
        count += Math.imul(half + (half >>> 4) & 0x0f0f0f0f, 0x01010101) >>> 24;
    }
    return count;
}

function shiftCount(value: bigint): bigint {
    if (value < 0n) throw new RankError('shift count must be nonnegative');
    return value;
}

function nonnegative(operation: string, value: bigint): bigint {
    if (value < 0n) throw new RankError(`${operation} expects a nonnegative integer`);
    return value;
}
