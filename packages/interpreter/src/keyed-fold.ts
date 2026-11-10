import { currentDiagnostics, recordFallback } from './diagnostics.js';
import { integer32Cells, integer64Cells, ownedArray, readArrayItem, realCells, typedElementKind } from './array-storage.js';
import { RankError } from './errors.js';
import { checkpoint, privateLoopPolling } from './interrupt.js';
import { sameShape } from './tensor-index.js';
import { isRankArray, MISSING, type RankArray, type RankValue } from './value.js';

export interface KeyedFoldOptions {
    readonly scan?: boolean;
    readonly operator?: string;
    readonly valueAt?: (index: number) => bigint;
    readonly keyAt?: (index: number) => bigint;
    readonly size?: number;
    readonly seed?: RankValue;
    readonly skipMissing?: boolean;
    readonly validate?: (value: RankValue) => RankValue;
    readonly initial?: (value: RankValue) => RankValue;
    readonly identity?: () => RankValue;
}

/** Maintain independent accumulators in source traversal order. */
export function keyedFold(values: RankValue, keys: RankValue,
    combine: (left: RankValue, right: RankValue) => RankValue,
    options: KeyedFoldOptions = {},
): RankArray {
    const diagnostics = currentDiagnostics();
    return diagnostics
        ? diagnostics.measure('keyed-fold.execute', () => executeKeyedFold(values, keys, combine, options))
        : executeKeyedFold(values, keys, combine, options);
}
function executeKeyedFold(values: RankValue, keys: RankValue,
    combine: (left: RankValue, right: RankValue) => RankValue,
    options: KeyedFoldOptions,
): RankArray {
    if (!isRankArray(values) || !isRankArray(keys)) {
        throw new RankError('by expects values and keys arrays', 'TypeError');
    }
    if (!sameShape(values.shape, keys.shape)) {
        throw new RankError('by keys must match the values shape', 'DimensionMismatch');
    }
    const { size, seed, identity, scan } = options;
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size >= 0xffffffff)) {
        throw new RankError('by size must be a nonnegative array length', 'DimensionMismatch');
    }
    const integers = integer32Cells(values), indices = integer32Cells(keys);
    if ((integers && indices || options.valueAt && options.keyAt)
        && ['+', '*', 'min', 'max'].includes(options.operator ?? '')
        && (seed === undefined || typeof seed === 'bigint')) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.integerKeyedFolds++;
        return integerKeyedFold(values.shape,
            integers ? index => integers[index] : options.valueAt!,
            indices ? index => indices[index] : options.keyAt!, options);
    }
    const wideKeys = !indices && privateLoopPolling() ? integer64Cells(keys) : undefined;
    const words = wideKeys?.buffer instanceof ArrayBuffer
        ? new Uint32Array(wideKeys.buffer, wideKeys.byteOffset, wideKeys.length * 2) : undefined;
    const lowWord = words ? new Uint8Array(new Uint32Array([1]).buffer)[0] === 1 ? 0 : 1 : 0;
    const realKey = indices ? (index: number) => indices[index] : words ? (index: number) => {
        const high = words[index * 2 + 1 - lowWord] | 0;
        // Invalid keys retain the generic error before the result-size check.
        return high < 0 ? -1 : high > 0 ? 0xffffffff : words[index * 2 + lowWord];
    } : undefined;
    const reals = typedElementKind(values) === 'real' ? realCells(values) : undefined;
    if (reals && realKey && ['+', '*', 'min', 'max'].includes(options.operator ?? '')
        && (seed === undefined || typeof seed === 'number'
            || typeof seed === 'bigint' && (options.operator === '+' || options.operator === '*'))) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.realKeyedFolds++;
        return realKeyedFold(reals, realKey, values.shape, options);
    }
    recordFallback('keyed-fold:generic',
        !indices || !integers && !reals ? 'representation' : 'effects');
    const count = values.shape.reduce((a, b) => a * b, 1);
    const states: RankValue[] = [];
    const output: RankValue[] = [];
    let length = size ?? 0;
    for (let index = 0; index < count; index++) {
        checkpoint('keyed fold');
        const key = options.keyAt ? options.keyAt(index) : readArrayItem(keys, index);
        if (typeof key !== 'bigint' || key < 0n || key >= 0xffffffffn) {
            throw new RankError('by keys must be nonnegative integer array indices', 'TypeError');
        }
        const at = Number(key);
        if (size !== undefined && at >= size) {
            throw new RankError('by key is outside the result size', 'IndexError');
        }
        length = Math.max(length, at + 1);
        let value = options.valueAt ? options.valueAt(index) : readArrayItem(values, index);
        if (options.skipMissing && value === MISSING) continue;
        if (options.validate) value = options.validate(value);
        const previous = states[at];
        states[at] = previous !== undefined ? combine(previous, value)
            : seed !== undefined ? combine(seed, value) : options.initial ? options.initial(value) : value;
        if (scan) output.push(states[at]);
    }
    if (scan) return ownedArray(output, values.shape);
    for (let at = 0; at < length; at++) {
        checkpoint('keyed fold');
        if (states[at] !== undefined) continue;
        if (seed !== undefined) states[at] = seed;
        else if (identity) states[at] = identity();
        else throw new RankError('empty keyed group requires an initial value', 'MissingValueError');
    }
    return ownedArray(states);
}


/** Whole-group statistics retain values, unlike streaming binary folds. */
export function keyedAggregate(values: RankValue, keys: RankValue,
    aggregate: (values: RankArray) => RankValue, options: KeyedFoldOptions = {}): RankArray {
    if (!isRankArray(values) || !isRankArray(keys)) {
        throw new RankError('by expects values and keys arrays', 'TypeError');
    }
    if (!sameShape(values.shape, keys.shape)) {
        throw new RankError('by keys must match the values shape', 'DimensionMismatch');
    }
    const { size, seed } = options;
    if (size !== undefined && (!Number.isSafeInteger(size) || size < 0 || size >= 0xffffffff)) {
        throw new RankError('by size must be a nonnegative array length', 'DimensionMismatch');
    }
    const groups: RankValue[][] = [];
    const count = values.shape.reduce((a, b) => a * b, 1);
    let length = size ?? 0;
    for (let index = 0; index < count; index++) {
        checkpoint('keyed aggregate');
        const key = readArrayItem(keys, index);
        if (typeof key !== 'bigint' || key < 0n || key >= 0xffffffffn) {
            throw new RankError('by keys must be nonnegative integer array indices', 'TypeError');
        }
        const at = Number(key);
        if (size !== undefined && at >= size) {
            throw new RankError('by key is outside the result size', 'IndexError');
        }
        length = Math.max(length, at + 1);
        (groups[at] ??= []).push(readArrayItem(values, index));
    }
    const result: RankValue[] = [];
    for (let at = 0; at < length; at++) {
        checkpoint('keyed aggregate');
        const group = groups[at];
        // A seed for a whole-group aggregate fills an absent group only.
        result.push(!group && seed !== undefined ? seed : aggregate(ownedArray(group ?? [])));
    }
    return ownedArray(result);
}


/** Integer producers and stored cells share the ordered consumer.
 * Each group widens independently; producer width never limits admission. */
function integerKeyedFold(shape: readonly number[],
    valueAt: (index: number) => number | bigint,
    keyAt: (index: number) => number | bigint,
    options: KeyedFoldOptions): RankArray {
    const { seed, identity, size, scan, operator } = options;
    const states: (number | bigint | undefined)[] = [];
    const output: RankValue[] = [];
    let length = size ?? 0;
    const exact = (value: number | bigint): bigint => typeof value === 'bigint' ? value : BigInt(value);
    const count = shape.reduce((a, b) => a * b, 1);
    for (let index = 0; index < count; index++) {
        checkpoint('integer keyed fold');
        const rawKey = keyAt(index);
        if (rawKey < 0 || rawKey >= 0xffffffff) {
            throw new RankError('by keys must be nonnegative integer array indices', 'TypeError');
        }
        const key = Number(rawKey);
        if (size !== undefined && key >= size) throw new RankError('by key is outside the result size', 'IndexError');
        length = Math.max(length, key + 1);
        const value = valueAt(index);
        const previous = states[key] ?? seed as bigint | undefined;
        let next: number | bigint = value;
        if (previous !== undefined) {
            if (typeof previous === 'number' && typeof next === 'number') {
                next = operator === '+' ? previous + next : operator === '*' ? previous * next
                    : operator === 'min' ? Math.min(previous, next) : Math.max(previous, next);
                if (!Number.isSafeInteger(next)) next = operator === '+' ? exact(previous) + exact(value)
                    : exact(previous) * exact(value);
            } else {
                const left = exact(previous), right = exact(value);
                next = operator === '+' ? left + right : operator === '*' ? left * right
                    : operator === 'min' ? left < right ? left : right : left > right ? left : right;
                if (typeof value === 'number') {
                    const number = Number(next);
                    if (Number.isSafeInteger(number)) next = number;
                }
            }
        }
        states[key] = next;
        if (scan) output.push(exact(next));
    }
    if (scan) return ownedArray(output, shape);
    // Complete the private group storage in place. Producer folds can have
    // wide states already; a second output array would retain both buffers.
    const result = states as RankValue[];
    for (let key = 0; key < length; key++) {
        checkpoint('integer keyed fold');
        const state = states[key];
        if (state !== undefined) result[key] = exact(state);
        else if (seed !== undefined) result[key] = seed;
        else if (identity) result[key] = identity();
        else throw new RankError('empty keyed group requires an initial value', 'MissingValueError');
    }
    return ownedArray(result);
}


/** Ordered Float64 folds retain the first extreme on ties, NaN and signed zero. */
function realKeyedFold(values: ArrayLike<number>, keyAt: (index: number) => number, shape: readonly number[],
    options: KeyedFoldOptions): RankArray {
    const { seed, identity, size, scan, operator } = options;
    const states: (number | undefined)[] = [];
    const output: RankValue[] = [];
    let length = size ?? 0;
    for (let index = 0; index < values.length; index++) {
        checkpoint('real keyed fold');
        const key = keyAt(index);
        if (key < 0 || key >= 0xffffffff) throw new RankError('by keys must be nonnegative integer array indices', 'TypeError');
        if (size !== undefined && key >= size) throw new RankError('by key is outside the result size', 'IndexError');
        length = Math.max(length, key + 1);
        const value = values[index];
        const previous = states[key] ?? (seed === undefined ? undefined : Number(seed));
        const next = previous === undefined ? value : operator === '+' ? previous + value
            : operator === '*' ? previous * value : operator === 'min'
                ? value < previous ? value : previous : value > previous ? value : previous;
        states[key] = next;
        if (scan) output.push(next);
    }
    if (scan) return ownedArray(output, shape);
    const result: RankValue[] = [];
    for (let key = 0; key < length; key++) {
        checkpoint('real keyed fold');
        const state = states[key];
        if (state !== undefined) result.push(state);
        else if (seed !== undefined) result.push(seed);
        else if (identity) result.push(identity());
        else throw new RankError('empty keyed group requires an initial value', 'MissingValueError');
    }
    return ownedArray(result);
}
