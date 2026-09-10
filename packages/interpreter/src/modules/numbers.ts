import { RankError } from '../errors.js';
import {
    mapSequence,
    reduceSequence,
    sequence,
    sequenceMask,
    sequenceValues,
} from '../sequence.js';
import {
    isRankArray,
    isRankSequence,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
} from '../value.js';
import { expectInteger, expectNumeric, mapValue, native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const numbersModule: RuntimeModule = {
    abs: () => native('abs', 1, arguments_ => {
        const value = expectNumeric(arguments_[0]);
        if (typeof value === 'bigint') return absolute(value);
        return value < 0 ? -value : value === 0 ? 0 : value;
    }, 0),
    sqrt: () => native('sqrt', 1, arguments_ => {
        const value = expectNumeric(arguments_[0]);
        if (value < 0) {
            throw new RankError('sqrt expects a nonnegative value', 'DomainError');
        }
        return Math.sqrt(Number(value));
    }, 0),
    round: () => native('round', 2, arguments_ =>
        roundValue(arguments_[0], arguments_[1])),
    sum: () => native('sum', 1, arguments_ => {
        const value = arguments_[0];
        if (isRankSequence(value)) {
            const planned = reduceSequence(value, 'sum');
            if (planned !== undefined) return expectNumeric(planned);
        }
        const items = isRankArray(value) ? value.items : sequenceValues(value, 'sum');
        let total: bigint | number = 0n;
        for (const item of items) total = add(total, expectNumeric(item));
        return total;
    }),
    min: () => numericExtreme('min', (left, right) => left < right),
    max: () => numericExtreme('max', (left, right) => left > right),
    infinity: () => Number.POSITIVE_INFINITY,
    gcd: () => native('gcd', 2, arguments_ =>
        greatestCommonDivisor(expectInteger(arguments_[0]), expectInteger(arguments_[1]))),
    powmod: () => native('powmod', 3, arguments_ => modularPower(
        expectInteger(arguments_[0]),
        expectInteger(arguments_[1]),
        expectInteger(arguments_[2]),
    )),
    lcm: () => native('lcm', [1, 2], arguments_ => {
        if (arguments_.length === 2) {
            return leastCommonMultiple(
                expectInteger(arguments_[0]),
                expectInteger(arguments_[1]),
            );
        }
        const value = arguments_[0];
        const items = isRankArray(value) ? value.items : sequenceValues(value, 'lcm');
        let result = 1n;
        for (const item of items) result = leastCommonMultiple(result, expectInteger(item));
        return result;
    }),
    factors: () => native('factors', 1, arguments_ => {
        const value = expectInteger(arguments_[0]);
        if (value < 1n) throw new RankError('factors expects a positive integer');
        return sequence(factorPlan(value));
    }),
    odd: () => predicateFunction('odd', value => expectInteger(value) % 2n !== 0n),
    even: () => predicateFunction('even', value => expectInteger(value) % 2n === 0n),
};

export function roundValue(value: RankValue, placesValue: RankValue): RankValue {
    if (typeof placesValue !== 'bigint') {
        throw new RankError('round places must be an integer', 'TypeError');
    }
    if (placesValue < BigInt(Number.MIN_SAFE_INTEGER)
        || placesValue > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError('round places must be a safe integer', 'RangeError');
    }
    const places = Number(placesValue);
    const roundScalar = (scalar: RankValue): RankValue => {
        if (typeof scalar === 'bigint') return roundInteger(scalar, places);
        if (typeof scalar === 'number') return roundReal(scalar, places);
        throw new RankError('round expects numeric input', 'TypeError');
    };
    if (isRankSequence(value)) return mapSequence(value, 'round', roundScalar);
    if (!isRankArray(value)) return roundScalar(value);

    const cached = new Map<number, RankValue>();
    const itemAt = (index: number): RankValue => {
        const previous = cached.get(index);
        if (previous !== undefined) return previous;
        const result = roundScalar(value.itemAt?.(index) ?? value.items[index]);
        cached.set(index, result);
        return result;
    };
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape: value.shape,
        itemAt,
        containsFiles: false,
        get items() {
            const size = value.shape.reduce((product, dimension) => product * dimension, 1);
            materialized ??= Array.from({ length: size }, (_, index) => itemAt(index));
            return materialized;
        },
    };
}

function numericExtreme(
    name: 'min' | 'max',
    replaces: (candidate: bigint | number, current: bigint | number) => boolean,
) {
    return native(name, [1, 2], arguments_ => {
        if (arguments_.length === 2) {
            const left = expectNumeric(arguments_[0]);
            const right = expectNumeric(arguments_[1]);
            return replaces(right, left) ? right : left;
        }
        const value = arguments_[0];
        if (isRankSequence(value)) {
            const planned = reduceSequence(value, name);
            if (planned !== undefined) return expectNumeric(planned);
        }
        const items = isRankArray(value) ? value.items : sequenceValues(value, name);
        let result: bigint | number | undefined;
        for (const item of items) {
            const numeric = expectNumeric(item);
            if (result === undefined || replaces(numeric, result)) result = numeric;
        }
        if (result === undefined) throw new RankError(`${name} requires at least one value`);
        return result;
    }, 'all', [0, 0]);
}

function add(left: bigint | number, right: bigint | number): bigint | number {
    return typeof left === 'bigint' && typeof right === 'bigint'
        ? left + right
        : Number(left) + Number(right);
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
    let a = absolute(left);
    let b = absolute(right);
    while (b !== 0n) [a, b] = [b, a % b];
    return a;
}

function leastCommonMultiple(left: bigint, right: bigint): bigint {
    if (left === 0n || right === 0n) return 0n;
    return absolute(left / greatestCommonDivisor(left, right) * right);
}

function modularPower(base: bigint, exponent: bigint, modulus: bigint): bigint {
    if (exponent < 0n) throw new RankError('powmod exponent must be nonnegative');
    if (modulus <= 0n) throw new RankError('powmod modulus must be positive');

    let factor = ((base % modulus) + modulus) % modulus;
    let power = exponent;
    let result = 1n % modulus;
    while (power > 0n) {
        if (power % 2n === 1n) result = result * factor % modulus;
        factor = factor * factor % modulus;
        power /= 2n;
    }
    return result;
}

function absolute(value: bigint): bigint {
    return value < 0n ? -value : value;
}

function roundInteger(value: bigint, places: number): bigint {
    if (places >= 0 || value === 0n) return value;
    const digits = -places;
    if (digits > absolute(value).toString().length) return 0n;
    const factor = 10n ** BigInt(digits);
    const quotient = value / factor;
    const remainder = absolute(value % factor);
    const comparison = remainder * 2n - factor;
    if (comparison < 0n || (comparison === 0n && absolute(quotient) % 2n === 0n)) {
        return quotient * factor;
    }
    return (quotient + (value < 0n ? -1n : 1n)) * factor;
}

function roundReal(value: number, places: number): number {
    if (!Number.isFinite(value) || value === 0) return value;
    if (places > 308) return value;
    if (places < -308) return value < 0 ? -0 : 0;

    const factor = 10 ** Math.abs(places);
    const scaled = places >= 0 ? value * factor : value / factor;
    if (!Number.isFinite(scaled)) return value;
    const rounded = roundTieToEven(scaled);
    return places >= 0 ? rounded / factor : rounded * factor;
}

function roundTieToEven(value: number): number {
    const lower = Math.floor(value);
    const fraction = value - lower;
    if (fraction < 0.5) return lower;
    if (fraction > 0.5) return lower + 1;
    return lower % 2 === 0 ? lower : lower + 1;
}

function factorPlan(value: bigint): SequencePlan {
    return {
        name: `factors of ${value}`,
        size: { kind: 'unknown' },
        *iterate() {
            let remaining = value;
            for (let divisor = 2n; divisor * divisor <= remaining; divisor += divisor === 2n ? 1n : 2n) {
                while (remaining % divisor === 0n) {
                    yield divisor;
                    remaining /= divisor;
                }
            }
            if (remaining > 1n) yield remaining;
        },
    };
}

function predicateFunction(name: string, test: (value: RankValue) => boolean) {
    const predicate: SequencePredicate = { name, optimizationKey: name, test };
    return native(name, 1, arguments_ => {
        const value = arguments_[0];
        return isRankSequence(value)
            ? sequenceMask(value, predicate)
            : mapValue(value, test);
    });
}
