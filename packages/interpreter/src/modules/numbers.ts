import { RankError } from '../errors.js';
import { mapBroadcastArrays } from '../tensor.js';
import {
    mapSequence,
    reduceSequence,
    sequence,
    sequenceMask,
    sequenceValues,
    zipSequences,
} from '../sequence.js';
import {
    isRankArray,
    isRankMultiset,
    isRankSequence,
    isRankSet,
    type RankArray,
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
    sin: () => unaryMath('sin', Math.sin, finiteDomain),
    cos: () => unaryMath('cos', Math.cos, finiteDomain),
    tan: () => unaryMath('tan', Math.tan, finiteDomain),
    asin: () => unaryMath('asin', Math.asin, unitDomain),
    acos: () => unaryMath('acos', Math.acos, unitDomain),
    atan: () => unaryMath('atan', Math.atan),
    atan2: () => native('atan2', 2, arguments_ => mapBinaryNumeric(
        arguments_[0],
        arguments_[1],
        'atan2',
        (left, right) => Math.atan2(left, right),
    ), 'all', [0, 0]),
    sinh: () => unaryMath('sinh', Math.sinh),
    cosh: () => unaryMath('cosh', Math.cosh),
    tanh: () => unaryMath('tanh', Math.tanh),
    asinh: () => unaryMath('asinh', Math.asinh),
    acosh: () => unaryMath('acosh', Math.acosh, value => value >= 1),
    atanh: () => unaryMath('atanh', Math.atanh, value => value > -1 && value < 1),
    sqrt: () => native('sqrt', 1, arguments_ => {
        const value = expectNumeric(arguments_[0]);
        if (value < 0) {
            throw new RankError('sqrt expects a nonnegative value', 'DomainError');
        }
        return Math.sqrt(Number(value));
    }, 0),
    isqrt: () => native('isqrt', 1, arguments_ => {
        const value = expectInteger(arguments_[0]);
        if (value < 0n) {
            throw new RankError('isqrt expects a nonnegative integer', 'DomainError');
        }
        return integerSquareRoot(value);
    }, 0),
    log: () => unaryMath(
        'log',
        Math.log,
        value => Number.isFinite(value) && value > 0,
    ),
    exp: () => unaryMath('exp', Math.exp),
    round: () => native('round', 2, arguments_ =>
        roundValue(arguments_[0], arguments_[1])),
    sum: () => native('sum', 1, arguments_ => {
        const value = arguments_[0];
        if (isRankSequence(value)) {
            const planned = reduceSequence(value, 'sum');
            if (planned !== undefined) return expectNumeric(planned);
        }
        const items = isRankArray(value)
            ? value.items
            : isRankSet(value)
                ? value.entries.values()
                : sequenceValues(value, 'sum');
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

function unaryMath(
    name: string,
    operation: (value: number) => number,
    accepts: (value: number) => boolean = () => true,
) {
    return native(name, 1, arguments_ => mapUnaryNumeric(
        arguments_[0],
        name,
        value => {
            if (!accepts(value)) {
                throw new RankError(`${name} input is outside its domain`, 'DomainError');
            }
            return operation(value);
        },
    ));
}

function mapUnaryNumeric(
    value: RankValue,
    name: string,
    operation: (value: number) => number,
): RankValue {
    if (isRankSequence(value)) {
        return mapSequence(value, name, item => operation(numericReal(item, name)));
    }
    if (!isRankArray(value)) return operation(numericReal(value, name));
    return mappedArray(value.shape, index =>
        operation(numericReal(value.itemAt?.(index) ?? value.items[index], name)));
}

function mapBinaryNumeric(
    left: RankValue,
    right: RankValue,
    name: string,
    operation: (left: number, right: number) => number,
): RankValue {
    const scalarOperation = (a: RankValue, b: RankValue) =>
        operation(numericReal(a, name), numericReal(b, name));
    if (isRankSequence(left) && isRankSequence(right)) {
        return zipSequences(left, right, name, scalarOperation);
    }
    if (isRankSequence(left)) {
        return mapSequence(left, name, item => scalarOperation(item, right));
    }
    if (isRankSequence(right)) {
        return mapSequence(right, name, item => scalarOperation(left, item));
    }
    if (isRankArray(left) && isRankArray(right)) {
        return mapBroadcastArrays(left, right, scalarOperation);
    }
    const array = isRankArray(left) ? left : isRankArray(right) ? right : undefined;
    if (!array) return scalarOperation(left, right);
    return mappedArray(array.shape, index => {
        const item = array.itemAt?.(index) ?? array.items[index];
        return isRankArray(left)
            ? scalarOperation(item, right)
            : scalarOperation(left, item);
    });
}

function mappedArray(
    shape: readonly number[],
    operation: (index: number) => RankValue,
): RankArray {
    const cache = new Map<number, RankValue>();
    const itemAt = (index: number): RankValue => {
        const cached = cache.get(index);
        if (cached !== undefined) return cached;
        const result = operation(index);
        cache.set(index, result);
        return result;
    };
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape,
        itemAt,
        containsFiles: false,
        get items() {
            const size = shape.reduce((product, dimension) => product * dimension, 1);
            materialized ??= Array.from({ length: size }, (_, index) => itemAt(index));
            return materialized;
        },
    };
}

function numericReal(value: RankValue, operation: string): number {
    if (typeof value !== 'bigint' && typeof value !== 'number') {
        throw new RankError(`${operation} expects numeric input`, 'TypeError');
    }
    return Number(value);
}

function finiteDomain(value: number): boolean {
    return Number.isFinite(value);
}

function unitDomain(value: number): boolean {
    return value >= -1 && value <= 1;
}

/** Return the exact floor of the square root using integer Newton iteration. */
function integerSquareRoot(value: bigint): bigint {
    if (value < 2n) return value;
    const bits = BigInt(value.toString(2).length);
    let root = 1n << ((bits + 1n) / 2n);
    for (;;) {
        const next = (root + value / root) / 2n;
        if (next >= root) return root;
        root = next;
    }
}

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
        if (isRankMultiset(value)) {
            const extreme = name === 'min' ? value.min() : value.max();
            if (extreme === undefined) {
                throw new RankError(`${name} requires at least one value`, 'EmptyReduction');
            }
            return expectNumeric(extreme);
        }
        if (isRankSequence(value)) {
            const planned = reduceSequence(value, name);
            if (planned !== undefined) return expectNumeric(planned);
        }
        const items = isRankArray(value)
            ? value.items
            : isRankSet(value)
                ? value.entries.values()
                : sequenceValues(value, name);
        let result: bigint | number | undefined;
        for (const item of items) {
            const numeric = expectNumeric(item);
            if (result === undefined || replaces(numeric, result)) result = numeric;
        }
        if (result === undefined) {
            throw new RankError(`${name} requires at least one value`, 'EmptyReduction');
        }
        return result;
    }, 'all', [0, 0]);
}

/** Sum an eager tensor cell by offset, retaining sum's integer-zero seed. */
export function sumIndexed(size: number, itemAt: (index: number) => RankValue): bigint | number {
    let total: bigint | number = 0n;
    for (let index = 0; index < size; index += 1) {
        total = add(total, expectNumeric(itemAt(index)));
    }
    return total;
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
