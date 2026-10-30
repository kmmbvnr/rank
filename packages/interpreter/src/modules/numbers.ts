import { registerScalarBuiltin } from '../scalar-builtin.js';
import { Factorizer, maxFactorTableInteger } from '../factorization.js';
import { withNumberCalls } from '../typed-native.js';
import { greatestCommonDivisor, safeIntegerGcd } from '../integer-gcd.js';
import { integerSquareRoot, safeIntegerSquareRoot } from '../integer-square-root.js';
import { mapStoredUnary } from '../unary-array-kernel.js';
import { mapScalarArrays } from '../scalar-array-map.js';
import { mapStoredIntegerTernary } from '../integer-array-kernel.js';
import { expectMultiset } from '../multiset.js';
import { checkpoint, inspectionEnabled, InterruptedError, privateLoopPolling } from '../interrupt.js';
import { prepareIntegerView } from '../integer-view.js';
import { arrayStrides, broadcastOffset, broadcastShape } from '../tensor-layout.js';
import { elementSource, type ElementSource } from '../element-source.js';
import { derivedArray, IntegerCells, ownedArray, typedArray } from '../array-storage.js';
import { RankError } from '../errors.js';
import { modularPower, probablePrime } from '../primality.js';
import { safeIntegerModularPower } from '../modular-power.js';
import { compareOrderedValues, orderedKind } from '../ordered.js';
import { mapBroadcastArrays } from '../tensor.js';
import { maxSqlite, sumSqlite } from './sqlite.js';
import {
    arraySequenceOperands,
    mapSequence,
    numericSource,
    sequence,
    sequenceMask,
    zipSequences,
} from '../sequence.js';
import {
    isRankArray,
    isRankLabel,
    isRankQueue,
    isRankSqliteExpression,
    isRankSequence,
    MISSING,
    tuple,
    type RankArray,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
} from '../value.js';
import { convolveExact } from '../convolution.js';
import { expectInteger, expectNumeric, mapValue, native, scalarNative } from './shared.js';
import type { RuntimeContext, RuntimeModule } from './types.js';

const factorizers = new WeakMap<RuntimeContext, Factorizer>();
function factorizer(context: RuntimeContext): Factorizer {
    let value = factorizers.get(context);
    if (!value) factorizers.set(context, value = new Factorizer());
    return value;
}

export const numbersModule: RuntimeModule = {
    abs: () => scalarNative('abs', argument => {
        if (argument === MISSING) return MISSING;
        const value = expectNumeric(argument);
        if (typeof value === 'bigint') return absolute(value);
        return value < 0 ? -value : value === 0 ? 0 : value;
    }, source => mapStoredUnary(source, 'real', Math.abs), 'numeric', 'abs'),
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
    )),
    sinh: () => unaryMath('sinh', Math.sinh),
    cosh: () => unaryMath('cosh', Math.cosh),
    tanh: () => unaryMath('tanh', Math.tanh),
    asinh: () => unaryMath('asinh', Math.asinh),
    acosh: () => unaryMath('acosh', Math.acosh, value => value >= 1),
    atanh: () => unaryMath('atanh', Math.atanh, value => value > -1 && value < 1),
    sqrt: () => scalarNative('sqrt', argument => {
        if (argument === MISSING) return MISSING;
        const value = expectNumeric(argument);
        if (value < 0) {
            throw new RankError('sqrt expects a nonnegative value', 'DomainError');
        }
        return Math.sqrt(Number(value));
    }, source => mapStoredUnary(source, 'number', value => {
        if (value < 0) throw new RankError('sqrt expects a nonnegative value', 'DomainError');
        return Math.sqrt(value);
    })),
    isqrt: () => scalarNative('isqrt', argument => {
        const value = expectInteger(argument);
        if (value < 0n) {
            throw new RankError('isqrt expects a nonnegative integer', 'DomainError');
        }
        return integerSquareRoot(value);
    }, source => mapStoredUnary(source, 'integer', value => {
        if (value < 0) throw new RankError('isqrt expects a nonnegative integer', 'DomainError');
        return safeIntegerSquareRoot(value);
    }, 'integer'), 'integer'),
    log: () => unaryMath(
        'log',
        Math.log,
        value => Number.isFinite(value) && value > 0,
    ),
    exp: () => unaryMath('exp', Math.exp),
    floor: () => integerBound('floor', Math.floor),
    ceil: () => integerBound('ceil', Math.ceil),
    digits: () => native('digits', 2, args => radixDigits(args[0], args[1])),
    fromDigits: () => native('fromDigits', 2, args => fromRadixDigits(args[0], args[1])),
    round: () => native('round', 2, arguments_ =>
        roundValue(arguments_[0], arguments_[1])),
    infinity: () => Number.POSITIVE_INFINITY,
    nan: () => Number.NaN,
    gcd: () => withNumberCalls(native('gcd', 2, arguments_ =>
        greatestCommonDivisor(expectInteger(arguments_[0]), expectInteger(arguments_[1]))), {
        'integer,integer': (a, b) => safeIntegerGcd(a, b),
    }, {
        'integer,integer': (a, b) => {
            // Match greatestCommonDivisor's safe-integer body checkpoint.
            checkpoint('computing numbers');
            return safeIntegerGcd(a, b);
        },
    }),
    powmod: () => native('powmod', 3, args => mapStoredIntegerTernary(args, checkedModularPower,
        (base, exponent, modulus) => exponent >= 0 && modulus > 0 && modulus <= 1073741824
            ? safeIntegerModularPower(base, exponent, modulus) : undefined)
        ?? mapScalarArrays(args, arguments_ => checkedModularPower(
        expectInteger(arguments_[0]),
        expectInteger(arguments_[1]),
        expectInteger(arguments_[2]),
    ))),
    convolve: () => native('convolve', 2, arguments_ => convolveExact(arguments_[0], arguments_[1])),
    binomial: () => native('binomial', 2, arguments_ => mapBinaryValue(
        arguments_[0],
        arguments_[1],
        'binomial',
        (left, right) => exactBinomial(expectInteger(left), expectInteger(right)),
    )),
    binomialmod: () => native('binomialmod', 3, args => {
        const modulus = expectInteger(args[2]);
        const stored = storedBinomial(args[0], args[1], modulus);
        if (stored) return stored;
        let cache: BinomialCache | undefined;
        return mapScalarArrays(args.slice(0, 2), cells => {
            const n = expectInteger(cells[0]), k = expectInteger(cells[1]);
            validateBinomial(n, k, 'binomialmod');
            cache ??= binomialCache(modulus);
            return modularBinomial(n, k, modulus, cache);
        });
    }),
    lcm: () => withNumberCalls(native('lcm', [1, 2], arguments_ => {
        if (arguments_.length === 2) {
            return leastCommonMultiple(
                expectInteger(arguments_[0]),
                expectInteger(arguments_[1]),
            );
        }
        const value = numericSource(arguments_[0], 'lcm');
        const source = elementSource(value, 'lcm', 'series');
        const items = source ? source.denseItems?.() ?? source.values() : [value];
        let result = 1n;
        for (const item of items) {
            checkpoint('computing numbers');
            result = leastCommonMultiple(result, expectInteger(item, 'lcm'));
        }
        return result;
    }), {
        'integer,integer': (a, b) => {
            if (a === 0 || b === 0) return 0;
            const divisor = safeIntegerGcd(a, b);
            const product = Math.abs(a / divisor * b);
            return Number.isSafeInteger(product) ? product : leastCommonMultiple(BigInt(a), BigInt(b));
        },
    }),
    factorsieve: context => native('factorsieve', 1, arguments_ => {
        const limit = expectInteger(arguments_[0]);
        if (limit < 0n || limit > BigInt(maxFactorTableInteger)) {
            throw new RankError(`factorsieve bound must be between 0 and ${maxFactorTableInteger}`, 'DomainError');
        }
        return typedArray(factorizer(context).smallestFactors(Number(limit)));
    }),
    factors: context => native('factors', 1, arguments_ => {
        const value = expectInteger(arguments_[0]);
        if (value < 1n) throw new RankError('factors expects a positive integer');
        return sequence(factorPlan(value, factorizer(context)));
    }),
    divisors: context => native('divisors', 1, arguments_ => {
        const value = expectInteger(arguments_[0]);
        if (value < 1n) throw new RankError('divisors expects a positive integer');
        return sequence(divisorPlan(value, factorizer(context)));
    }),
    // `asUintN` reads the low bit; `% 2n` divides the whole BigInt in V8.
    odd: () => predicateFunction('odd', value => BigInt.asUintN(1, expectInteger(value)) !== 0n),
    even: () => predicateFunction('even', value => BigInt.asUintN(1, expectInteger(value)) === 0n),
    isnan: () => predicateFunction('isnan', value => value !== MISSING && Number.isNaN(Number(expectNumeric(value)))),
};

function unaryMath(
    name: string,
    operation: (value: number) => number,
    accepts: (value: number) => boolean = () => true,
) {
    const checked = (value: number): number => {
        if (!accepts(value)) {
            throw new RankError(`${name} input is outside its domain`, 'DomainError');
        }
        return operation(value);
    };
    return scalarNative(name, item => item === MISSING ? MISSING : checked(numericReal(item, name)),
        source => mapStoredUnary(source, 'number', checked), 'real');
}

function mapBinaryValue(
    left: RankValue,
    right: RankValue,
    name: string,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankValue {
    [left, right] = arraySequenceOperands(left, right);
    // A cell with no value stays without one.
    const scalarOperation = (a: RankValue, b: RankValue): RankValue =>
        a === MISSING || b === MISSING ? MISSING : operation(a, b);
    if (isRankSequence(left) && isRankSequence(right)) {
        return zipSequences(left, right, name, scalarOperation, true);
    }
    if (isRankSequence(left)) {
        return mapSequence(left, name, item => scalarOperation(item, right), typeof right !== 'object');
    }
    if (isRankSequence(right)) {
        return mapSequence(right, name, item => scalarOperation(left, item), typeof left !== 'object');
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
        if (scalar === MISSING) return MISSING;
        if (typeof scalar === 'bigint') return roundInteger(scalar, places);
        if (typeof scalar === 'number') return roundReal(scalar, places);
        throw new RankError('round expects numeric input', 'TypeError');
    };
    if (isRankSequence(value)) return mapSequence(value, 'round', roundScalar, true);
    if (!isRankArray(value)) return roundScalar(value);

    return derivedArray(value.shape, [value], index =>
        roundScalar(value.itemAt?.(index) ?? value.items[index]), true);
}

export function numericExtreme(
    name: 'min' | 'max',
    replaces: (candidate: bigint | number, current: bigint | number) => boolean,
) {
    // Numbers keep the numeric fast path; text and other ordered scalars
    // compare with the same ordering as `less` and `greater`.
    const expectExtremeOperand = (value: RankValue): RankValue => {
        if (typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'object' && value !== null && value !== MISSING && !isRankArray(value)) {
            orderedKind(value);
            return value;
        }
        return expectNumeric(value);
    };
    const replacesExtreme = (candidate: RankValue, current: RankValue): boolean => {
        if (typeof candidate === 'object' || typeof candidate === 'string' || typeof candidate === 'boolean'
            || typeof current === 'object' || typeof current === 'string' || typeof current === 'boolean') {
            const kind = orderedKind(candidate);
            if (kind !== orderedKind(current)) throw new RankError('expected numeric input');
            const order = compareOrderedValues(candidate, current, kind);
            return name === 'min' ? order < 0 : order > 0;
        }
        return replaces(candidate, current);
    };
    const binary = (a: RankValue, b: RankValue): RankValue => {
        if ((typeof a === 'object' || typeof b === 'object')
            && (isRankArray(a) || isRankArray(b) || isRankSequence(a) || isRankSequence(b)
                || isRankQueue(a) || isRankQueue(b))) return mapBinaryValue(a, b, name, binary);
        if (a === MISSING || b === MISSING) return MISSING;
        const left = expectExtremeOperand(a);
        const right = expectExtremeOperand(b);
        return replacesExtreme(right, left) ? right : left;
    };
    /** `.index` and `.indexed`: the first position of the extreme, found in the same pass. */
    const positionedExtreme = (source: RankValue, mode: string): RankValue => {
        if (mode !== 'index' && mode !== 'indexed') {
            throw new RankError(`${name} accepts only the .index and .indexed modifiers`, 'TypeError');
        }
        const value = numericSource(source, name);
        const access = elementSource(value, name, 'positioned');
        if (access?.rank !== undefined && access.rank !== 1)
            throw new RankError(`${name} .${mode} expects a rank-1 collection`, 'DimensionMismatch');
        if (!access) throw new RankError(`${name} .${mode} expects an array or sequence`, 'TypeError');
        const items = access.denseItems?.() ?? access.values();
        let result: RankValue | undefined;
        let position = 0n;
        let index = 0n;
        for (const item of items) {
            checkpoint('computing numbers');
            if (item !== MISSING) {
                const operand = expectExtremeOperand(item);
                if (result === undefined || replacesExtreme(operand, result)) {
                    result = operand;
                    position = index;
                }
            }
            index += 1n;
        }
        if (result === undefined) {
            throw new RankError(`${name} requires at least one value`, 'EmptyReduction');
        }
        return mode === 'index' ? position : tuple([result, position]);
    };
    return native(name, [1, 2], arguments_ => {
        if (arguments_.length === 2 && isRankLabel(arguments_[1])) {
            return positionedExtreme(arguments_[0], arguments_[1].name);
        }
        if (arguments_.length === 2) {
            return binary(arguments_[0], arguments_[1]);
        }
        const value = numericSource(arguments_[0], name);
        if (name === 'max' && isRankSqliteExpression(value)) return maxSqlite(value);
        const source = elementSource(value, name, 'extrema');
        const planned = source?.reduce?.(name);
        if (planned !== undefined) return expectExtremeOperand(planned);
        const items = source ? source.denseItems?.() ?? source.values() : [value];
        let result: RankValue | undefined;
        for (const item of items) {
            checkpoint('computing numbers');
            if (item === MISSING) continue;
            const operand = expectExtremeOperand(item);
            if (result === undefined || replacesExtreme(operand, result)) result = operand;
        }
        if (result === undefined) {
            throw new RankError(`${name} requires at least one value`, 'EmptyReduction');
        }
        return result;
    });
}

/** The same left fold as `sumArray`, over cells read one at a time. */
function sumStream(items: Iterable<RankValue>): bigint | number {
    let total: bigint | number = 0n;
    for (const item of items) {
        checkpoint('computing numbers');
        if (item !== MISSING) total = add(total, expectNumeric(item, 'sum'));
    }
    return total;
}

const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Sum a packed integer buffer by the 32-bit halves of its cells, as plain
 * numbers a chunk at a time, so no bigint is allocated for each cell. A chunk
 * of 4096 low halves stays far below 2^53. */
function sumPacked(cells: BigInt64Array): bigint {
    const words = new Int32Array(cells.buffer, cells.byteOffset, cells.length * 2);
    let total = 0n;
    for (let start = 0; start < cells.length; start += 4096) {
        const end = Math.min(cells.length, start + 4096);
        checkpoint('computing numbers', end - start);
        let low = 0, high = 0;
        for (let i = start * 2; i < end * 2; i += 2) {
            low += words[i] >>> 0;
            high += words[i + 1];
        }
        total += (BigInt(high) << 32n) + BigInt(low);
    }
    return total;
}

/** Sum integers without a generic numeric callback on every element.
 * Promotion happens at the first real value, in the original left-fold order. */
function sumArray(items: ArrayLike<RankValue>): bigint | number {
    if (items instanceof BigInt64Array && littleEndian) return sumPacked(items);
    let integer = 0n;
    for (let index = 0; index < items.length; index++) {
        checkpoint('computing numbers');
        const item = items[index];
        if (typeof item === 'bigint') { integer += item; continue; }
        if (item === MISSING) continue;
        let real = Number(integer) + Number(expectNumeric(item, 'sum'));
        for (index++; index < items.length; index++) {
            checkpoint('computing numbers');
            const next = items[index];
            if (next !== MISSING) real += Number(expectNumeric(next, 'sum'));
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
        const item = itemAt(index);
        if (item !== MISSING) total = add(total, expectNumeric(item, 'sum'));
    }
    return total;
}

function add(left: bigint | number, right: bigint | number): bigint | number {
    return typeof left === 'bigint' && typeof right === 'bigint'
        ? left + right
        : Number(left) + Number(right);
}

function leastCommonMultiple(left: bigint, right: bigint): bigint {
    if (left === 0n || right === 0n) return 0n;
    return absolute(left / greatestCommonDivisor(left, right) * right);
}

function checkedModularPower(base: bigint, exponent: bigint, modulus: bigint): bigint {
    if (exponent < 0n) throw new RankError('powmod exponent must be nonnegative');
    if (modulus <= 0n) throw new RankError('powmod modulus must be positive');
    const b = Number(base), e = Number(exponent), m = Number(modulus);
    if (Number.isSafeInteger(b) && Number.isSafeInteger(e) && m <= 1073741824) {
        return BigInt(safeIntegerModularPower(b, e, m));
    }
    return modularPower(base, exponent, modulus);
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

function binomialCache(modulus: bigint): BinomialCache {
    if (modulus > 18446744073709551615n) {
        throw new RankError('binomialmod modulus exceeds the 64-bit limit', 'DomainError');
    }
    if (modulus < 2n || !probablePrime(modulus)) {
        throw new RankError('binomialmod modulus must be prime', 'DomainError');
    }
    const cache = binomialCaches.get(modulus) ?? createBinomialCache();
    binomialCaches.set(modulus, cache);
    return cache;
}

function binomialLimit(n: bigint, modulus: bigint): number {
    if (n >= modulus) {
        throw new RankError('binomialmod requires N less than its modulus', 'DomainError');
    }
    const limit = Number(n);
    if (!Number.isSafeInteger(limit)) {
        throw new RankError('binomialmod N is too large to cache', 'DomainError');
    }
    return limit;
}

function modularBinomial(n: bigint, k: bigint, modulus: bigint, cache: BinomialCache): bigint {
    const limit = binomialLimit(n, modulus);
    extendBinomialCache(cache, limit, modulus);
    return cachedBinomial(limit, Number(k), modulus, cache);
}

function cachedBinomial(limit: number, chosen: number, modulus: bigint, cache: BinomialCache): bigint {
    return cache.factorial[limit]
        * cache.inverseFactorial[chosen] % modulus
        * cache.inverseFactorial[limit - chosen] % modulus;
}

/** Completed integer storage can prepare the cache once for the whole broadcast.
 * Invalid domains fall back to the cell mapper so unread errors remain deferred. */
function storedBinomial(left: RankValue, right: RankValue, modulus: bigint): RankArray | undefined {
    if (inspectionEnabled() || !privateLoopPolling()) return undefined;
    const a = isRankArray(left) ? prepareIntegerView(left, true) : undefined;
    const b = isRankArray(right) ? prepareIntegerView(right, true) : undefined;
    if (isRankArray(left) ? !a?.regular : typeof left !== 'bigint') return undefined;
    if (isRankArray(right) ? !b?.regular : typeof right !== 'bigint') return undefined;
    if (!a && !b) return undefined;
    const shape = broadcastShape(a?.shape ?? [], b?.shape ?? []);
    const reader = (view: typeof a, scalar: RankValue) => {
        if (!view) return (_: number) => scalar as bigint;
        const same = view.shape.length === shape.length && view.shape.every((n, i) => n === shape[i]);
        const strides = arrayStrides(view.shape);
        return (index: number) => view.read(same ? index : broadcastOffset(index, shape, view.shape, strides));
    };
    const nAt = reader(a, left), kAt = reader(b, right);
    const size = shape.reduce((n, dimension) => n * dimension, 1);
    const cells = new IntegerCells(size);
    if (size === 0) return cells.array(shape);
    try {
        let maximum = 0;
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('checking binomial array', end - start);
            for (let index = start; index < end; index++) {
                const n = nAt(index), k = kAt(index);
                validateBinomial(n, k, 'binomialmod');
                maximum = Math.max(maximum, binomialLimit(n, modulus));
            }
        }
        const cache = binomialCache(modulus);
        extendBinomialCache(cache, maximum, modulus);
        for (let start = 0; start < size; start += 4096) {
            const end = Math.min(size, start + 4096);
            checkpoint('computing binomial array', end - start);
            for (let index = start; index < end; index++) {
                cells.set(index, cachedBinomial(Number(nAt(index)), Number(kAt(index)), modulus, cache));
            }
        }
    } catch (error) {
        if (error instanceof InterruptedError) throw error;
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return cells.array(shape);
}

function validateBinomial(n: bigint, k: bigint, name: string): void {
    if (n < 0n || k < 0n || k > n) {
        throw new RankError(`${name} requires 0 at most K at most N`, 'DomainError');
    }
}

function createBinomialCache(): BinomialCache {
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

function factorPlan(value: bigint, factorizer: Factorizer): SequencePlan {
    return {
        name: `factors of ${value}`,
        size: { kind: 'unknown' },
        iterate: () => factorizer.factors(value),
    };
}

function divisorPlan(value: bigint, factorizer: Factorizer): SequencePlan {
    return {
        name: `divisors of ${value}`,
        size: { kind: 'unknown' },
        *iterate() {
            const values = [1n];
            for (const [prime, exponent] of factorPowers(value, factorizer)) {
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
            return factorPowers(value, factorizer).reduce(
                (count, [, exponent]) => count * BigInt(exponent + 1),
                1n,
            );
        },
    };
}

function factorPowers(value: bigint, factorizer: Factorizer): readonly [bigint, number][] {
    const result: [bigint, number][] = [];
    for (const prime of factorizer.factors(value)) {
        const previous = result[result.length - 1];
        if (previous?.[0] === prime) previous[1] += 1;
        else result.push([prime, 1]);
    }
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
    value = numericSource(value, 'sum');
    if (isRankSqliteExpression(value)) return sumSqlite(value);
    const source = elementSource(value, 'sum');
    if (!source) return sumStream([value]);
    return sumElements(source);
}

/** The reduction depends on element access, not a collection's concrete kind. */
export function sumElements(source: ElementSource): bigint | number {
    const reduced = source.reduce?.('sum');
    if (reduced !== undefined) return expectNumeric(reduced, 'sum');
    // Real cells held in a typed buffer are added in place, not boxed one by one first.
    const reals = source.realCells?.();
    if (reals?.length) {
        let total = 0;
        for (let index = 0; index < reals.length; index += 1) {
            checkpoint('computing numbers');
            total += reals[index];
        }
        return total;
    }
    const items = source.denseItems?.();
    return items ? sumArray(items) : sumStream(source.values());
}

function integerBound(name: 'floor' | 'ceil', operation: (value: number) => number) {
    const checked = (number: number): number => {
        if (!Number.isFinite(number)) throw new RankError(`${name} expects a finite number`, 'DomainError');
        return operation(number);
    };
    const apply = (value: RankValue): RankValue => {
        if (value === MISSING || typeof value === 'bigint') return value;
        const number = numericReal(value, name);
        return BigInt(checked(number));
    };
    return registerScalarBuiltin(native(name, name === 'floor' ? [1, 2] : 1, args => args.length === 2
        ? expectMultiset(args[0]).floor(args[1]) : apply(args[0])), apply,
        source => mapStoredUnary(source, 'number', checked, 'integer'), 'integer');
}

function radixBases(value: RankValue): bigint[] {
    if (!isRankArray(value) || value.shape.length !== 1 || !value.shape[0]) {
        throw new RankError('bases must be a nonempty rank-1 integer array', 'TypeError');
    }
    return Array.from({ length: value.shape[0] }, (_, i) => {
        const base = expectInteger(value.itemAt?.(i) ?? value.items[i]);
        if (base < 2n) throw new RankError('bases must be at least 2', 'DomainError');
        return base;
    });
}

function radixDigits(value: RankValue, basesValue: RankValue): RankValue {
    const bases = radixBases(basesValue);
    const shape = isRankArray(value) ? value.shape : [];
    const size = shape.reduce((a, b) => a * b, 1);
    const items: RankValue[] = new Array(size * bases.length);
    for (let i = 0; i < size; i++) {
        checkpoint('computing digits');
        let remaining = expectInteger(isRankArray(value) ? value.itemAt?.(i) ?? value.items[i] : value);
        if (remaining < 0n) throw new RankError('digits expects nonnegative integers', 'DomainError');
        for (let axis = bases.length - 1; axis >= 0; axis--) {
            items[axis * size + i] = remaining % bases[axis];
            remaining /= bases[axis];
        }
        if (remaining) throw new RankError('integer does not fit the supplied bases', 'RangeError');
    }
    return ownedArray(items, [bases.length, ...shape]);
}

function fromRadixDigits(value: RankValue, basesValue: RankValue): RankValue {
    const bases = radixBases(basesValue);
    if (!isRankArray(value) || value.shape[0] !== bases.length) {
        throw new RankError('fromDigits expects a leading digit axis matching the bases', 'DimensionMismatch');
    }
    const shape = value.shape.slice(1);
    const size = shape.reduce((a, b) => a * b, 1);
    const items: RankValue[] = new Array(size);
    for (let i = 0; i < size; i++) {
        checkpoint('computing fromDigits');
        let result = 0n;
        for (let axis = 0; axis < bases.length; axis++) {
            const offset = axis * size + i;
            const digit = expectInteger(value.itemAt?.(offset) ?? value.items[offset]);
            if (digit < 0n || digit >= bases[axis]) throw new RankError('digit is outside its base', 'DomainError');
            result = result * bases[axis] + digit;
        }
        items[i] = result;
    }
    return shape.length ? ownedArray(items, shape) : items[0];
}
