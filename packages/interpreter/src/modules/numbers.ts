import { checkpoint } from '../interrupt.js';
import { derivedArray } from '../array-storage.js';
import { RankError } from '../errors.js';
import { mapBroadcastArrays } from '../tensor.js';
import { maxSqlite, sumSqlite } from './sqlite.js';
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
    isRankQueue,
    isRankSqliteExpression,
    isRankSequence,
    isRankSet,
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
    atan2: () => native('atan2', 2, arguments_ => mapBinaryValue(
        arguments_[0],
        arguments_[1],
        'atan2',
        (left, right) => Math.atan2(numericReal(left, 'atan2'), numericReal(right, 'atan2')),
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
    infinity: () => Number.POSITIVE_INFINITY,
    gcd: () => native('gcd', 2, arguments_ =>
        greatestCommonDivisor(expectInteger(arguments_[0]), expectInteger(arguments_[1]))),
    powmod: () => native('powmod', 3, arguments_ => modularPower(
        expectInteger(arguments_[0]),
        expectInteger(arguments_[1]),
        expectInteger(arguments_[2]),
    )),
    binomial: () => native('binomial', 2, arguments_ => mapBinaryValue(
        arguments_[0],
        arguments_[1],
        'binomial',
        (left, right) => exactBinomial(expectInteger(left), expectInteger(right)),
    ), 'all', [0, 0]),
    binomialmod: () => native('binomialmod', 3, arguments_ => modularBinomial(
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
        for (const item of items) {
            checkpoint('computing numbers');
            result = leastCommonMultiple(result, expectInteger(item));
        }
        return result;
    }),
    factors: () => native('factors', 1, arguments_ => {
        const value = expectInteger(arguments_[0]);
        if (value < 1n) throw new RankError('factors expects a positive integer');
        return sequence(factorPlan(value));
    }),
    divisors: () => native('divisors', 1, arguments_ => {
        const value = expectInteger(arguments_[0]);
        if (value < 1n) throw new RankError('divisors expects a positive integer');
        return sequence(divisorPlan(value));
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
    return derivedArray(value.shape, [value], index =>
        operation(numericReal(value.itemAt?.(index) ?? value.items[index], name)), true);
}

function mapBinaryValue(
    left: RankValue,
    right: RankValue,
    name: string,
    scalarOperation: (left: RankValue, right: RankValue) => RankValue,
): RankValue {
    if (isRankSequence(left) && isRankSequence(right)) {
        return zipSequences(left, right, name, scalarOperation);
    }
    if (isRankSequence(left)) {
        return mapSequence(left, name, item => scalarOperation(item, right));
    }
    if (isRankSequence(right)) {
        return mapSequence(right, name, item => scalarOperation(left, item));
    }
    if (isRankQueue(left)) left = { kind: 'array', items: left.items, shape: [left.items.length] };
    if (isRankQueue(right)) right = { kind: 'array', items: right.items, shape: [right.items.length] };
    if (isRankArray(left) && isRankArray(right)) {
        return mapBroadcastArrays(left, right, scalarOperation);
    }
    const array = isRankArray(left) ? left : isRankArray(right) ? right : undefined;
    if (!array) return scalarOperation(left, right);
    return derivedArray(array.shape, [array], index => {
        const item = array.itemAt?.(index) ?? array.items[index];
        return isRankArray(left)
            ? scalarOperation(item, right)
            : scalarOperation(left, item);
    }, true);
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
        checkpoint('computing numbers');
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

    return derivedArray(value.shape, [value], index =>
        roundScalar(value.itemAt?.(index) ?? value.items[index]), true);
}

export function numericExtreme(
    name: 'min' | 'max',
    replaces: (candidate: bigint | number, current: bigint | number) => boolean,
) {
    const binary = (a: RankValue, b: RankValue): RankValue => {
        if ((typeof a === 'object' || typeof b === 'object')
            && (isRankArray(a) || isRankArray(b) || isRankSequence(a) || isRankSequence(b)
                || isRankQueue(a) || isRankQueue(b))) return mapBinaryValue(a, b, name, binary);
        const left = expectNumeric(a);
        const right = expectNumeric(b);
        return replaces(right, left) ? right : left;
    };
    return native(name, [1, 2], arguments_ => {
        if (arguments_.length === 2) {
            return binary(arguments_[0], arguments_[1]);
        }
        const value = arguments_[0];
        if (name === 'max' && isRankSqliteExpression(value)) return maxSqlite(value);
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
            checkpoint('computing numbers');
            const numeric = expectNumeric(item);
            if (result === undefined || replaces(numeric, result)) result = numeric;
        }
        if (result === undefined) {
            throw new RankError(`${name} requires at least one value`, 'EmptyReduction');
        }
        return result;
    }, 'all', [0, 0]);
}

/** Sum integers without a generic numeric callback on every element.
 * Promotion happens at the first real value, in the original left-fold order. */
function sumArray(items: readonly RankValue[]): bigint | number {
    let integer = 0n;
    for (let index = 0; index < items.length; index++) {
        checkpoint('computing numbers');
        const item = items[index];
        if (typeof item === 'bigint') { integer += item; continue; }
        let real = Number(integer) + Number(expectNumeric(item));
        for (index++; index < items.length; index++) {
            checkpoint('computing numbers');
            real += Number(expectNumeric(items[index]));
        }
        return real;
    }
    return integer;
}

/** Sum an eager tensor cell by offset, retaining sum's integer-zero seed. */
export function sumIndexed(size: number, itemAt: (index: number) => RankValue): bigint | number {
    let total: bigint | number = 0n;
    for (let index = 0; index < size; index += 1) {
        checkpoint('computing numbers');
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
    while (b !== 0n) {
        checkpoint('computing numbers');
        [a, b] = [b, a % b];
    }
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
        checkpoint('computing numbers', 1024);
        if (power % 2n === 1n) result = result * factor % modulus;
        factor = factor * factor % modulus;
        power /= 2n;
    }
    return result;
}

function exactBinomial(n: bigint, k: bigint): bigint {
    validateBinomial(n, k, 'binomial');
    const count = k < n - k ? k : n - k;
    let result = 1n;
    for (let index = 1n; index <= count; index += 1n) {
        checkpoint('computing binomial', 1024);
        result = result * (n - count + index) / index;
    }
    return result;
}

interface BinomialCache {
    readonly factorial: bigint[];
    readonly inverse: bigint[];
    readonly inverseFactorial: bigint[];
}

const binomialCaches = new Map<bigint, BinomialCache>();

function modularBinomial(n: bigint, k: bigint, modulus: bigint): bigint {
    validateBinomial(n, k, 'binomialmod');
    if (modulus > 18446744073709551615n) {
        throw new RankError('binomialmod modulus exceeds the 64-bit limit', 'DomainError');
    }
    if (modulus < 2n || !probablePrime(modulus)) {
        throw new RankError('binomialmod modulus must be prime', 'DomainError');
    }
    if (n >= modulus) {
        throw new RankError('binomialmod requires N less than its modulus', 'DomainError');
    }
    const limit = Number(n);
    if (!Number.isSafeInteger(limit)) {
        throw new RankError('binomialmod N is too large to cache', 'DomainError');
    }
    const cache = binomialCaches.get(modulus) ?? createBinomialCache(modulus);
    binomialCaches.set(modulus, cache);
    extendBinomialCache(cache, limit, modulus);
    const chosen = Number(k);
    return cache.factorial[limit]
        * cache.inverseFactorial[chosen] % modulus
        * cache.inverseFactorial[limit - chosen] % modulus;
}

function validateBinomial(n: bigint, k: bigint, name: string): void {
    if (n < 0n || k < 0n || k > n) {
        throw new RankError(`${name} requires 0 at most K at most N`, 'DomainError');
    }
}

function createBinomialCache(modulus: bigint): BinomialCache {
    return { factorial: [1n], inverse: [0n, 1n], inverseFactorial: [1n] };
}

function extendBinomialCache(cache: BinomialCache, limit: number, modulus: bigint): void {
    for (let index = cache.factorial.length; index <= limit; index += 1) {
        checkpoint('computing binomial');
        const value = BigInt(index);
        cache.factorial.push(cache.factorial[index - 1] * value % modulus);
        const inverse = index === 1
            ? 1n
            : modulus - modulus / value * cache.inverse[Number(modulus % value)] % modulus;
        cache.inverse[index] = inverse;
        cache.inverseFactorial[index] = cache.inverseFactorial[index - 1] * inverse % modulus;
    }
}

function probablePrime(value: bigint): boolean {
    if (value < 2n) return false;
    for (const prime of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
        checkpoint('computing numbers');
        if (value === prime) return true;
        if (value % prime === 0n) return false;
    }
    let odd = value - 1n;
    let shifts = 0;
    while (odd % 2n === 0n) {
        checkpoint('computing numbers');
        odd /= 2n;
        shifts += 1;
    }
    for (const witness of [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n]) {
        checkpoint('computing numbers');
        const base = witness % value;
        if (base === 0n) continue;
        let power = modularPower(base, odd, value);
        if (power === 1n || power === value - 1n) continue;
        let composite = true;
        for (let step = 1; step < shifts; step += 1) {
            checkpoint('computing numbers');
            power = power * power % value;
            if (power === value - 1n) {
                composite = false;
                break;
            }
        }
        if (composite) return false;
    }
    return true;
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
                checkpoint('searching factors');
                while (remaining % divisor === 0n) {
                    checkpoint('computing numbers');
                    yield divisor;
                    remaining /= divisor;
                }
            }
            if (remaining > 1n) yield remaining;
        },
    };
}

function divisorPlan(value: bigint): SequencePlan {
    let cached: readonly [bigint, number][] | undefined;
    const powers = () => cached ??= factorPowers(value);
    return {
        name: `divisors of ${value}`,
        size: { kind: 'unknown' },
        *iterate() {
            const values = [1n];
            for (const [prime, exponent] of powers()) {
                checkpoint('computing numbers');
                const previous = values.length;
                let multiplier = 1n;
                for (let power = 1; power <= exponent; power += 1) {
                    checkpoint('computing numbers');
                    multiplier *= prime;
                    for (let index = 0; index < previous; index += 1) {
                        checkpoint('computing numbers');
                        values.push(values[index] * multiplier);
                    }
                }
            }
            values.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
            yield* values;
        },
        contains(candidate) {
            return typeof candidate === 'bigint'
                && candidate > 0n
                && value % candidate === 0n;
        },
        reduce(operation) {
            if (operation !== 'count') return undefined;
            return powers().reduce(
                (count, [, exponent]) => count * BigInt(exponent + 1),
                1n,
            );
        },
    };
}

function factorPowers(value: bigint): readonly [bigint, number][] {
    const result: [bigint, number][] = [];
    let remaining = value;
    for (
        let divisor = 2n;
        divisor * divisor <= remaining;
        divisor += divisor === 2n ? 1n : 2n
    ) {
        checkpoint('searching factors');
        let exponent = 0;
        while (remaining % divisor === 0n) {
            checkpoint('computing numbers');
            exponent += 1;
            remaining /= divisor;
        }
        if (exponent > 0) result.push([divisor, exponent]);
    }
    if (remaining > 1n) result.push([remaining, 1]);
    return result;
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

export function sumValue(value: RankValue): RankValue {
    if (isRankSqliteExpression(value)) return sumSqlite(value);
    if (isRankSequence(value)) {
        const planned = reduceSequence(value, 'sum');
        if (planned !== undefined) return expectNumeric(planned);
    }
    if (isRankArray(value)) return sumArray(value.items);
    const items = isRankSet(value)
        ? value.entries.values()
        : sequenceValues(value, 'sum');
    let total: bigint | number = 0n;
    for (const item of items) {
        checkpoint('computing numbers');
        total = add(total, expectNumeric(item));
    }
    return total;
}
