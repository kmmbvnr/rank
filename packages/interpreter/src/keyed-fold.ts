import { currentDiagnostics } from './diagnostics.js';
import { integer32Cells, ownedArray, readArrayItem, realCells, typedElementKind } from './array-storage.js';
import { RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { sameShape } from './tensor-index.js';
import { isRankArray, MISSING, type RankArray, type RankValue } from './value.js';

export interface KeyedFoldOptions {
    readonly scan?: boolean;
    readonly operator?: string;
    readonly valueAt?: (index: number) => RankValue;
    readonly keyAt?: (index: number) => RankValue;
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
    if (integers && indices && ['+', '*', 'min', 'max'].includes(options.operator ?? '')
        && (seed === undefined || typeof seed === 'bigint')) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.integerKeyedFolds++;
        return integerKeyedFold(integers, indices, values.shape, options);
    }
    const reals = typedElementKind(values) === 'real' ? realCells(values) : undefined;
    if (reals && indices && ['+', '*', 'min', 'max'].includes(options.operator ?? '')
        && (seed === undefined || typeof seed === 'number'
            || typeof seed === 'bigint' && (options.operator === '+' || options.operator === '*'))) {
        const diagnostics = currentDiagnostics();
        if (diagnostics) diagnostics.realKeyedFolds++;
        return realKeyedFold(reals, indices, values.shape, options);
    }
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


/** Raw Int32 operands keep safe partials unboxed; each group widens independently. */
function integerKeyedFold(values: Int32Array, keys: Int32Array, shape: readonly number[],
    options: KeyedFoldOptions): RankArray {
    const { seed, identity, size, scan, operator } = options;
    const states: (number | bigint | undefined)[] = [];
    const output: RankValue[] = [];
    let length = size ?? 0;
    const exact = (value: number | bigint): bigint => typeof value === 'bigint' ? value : BigInt(value);
    for (let index = 0; index < values.length; index++) {
        checkpoint('integer keyed fold');
        const key = keys[index];
        if (key < 0) throw new RankError('by keys must be nonnegative integer array indices', 'TypeError');
        if (size !== undefined && key >= size) throw new RankError('by key is outside the result size', 'IndexError');
        length = Math.max(length, key + 1);
        const value = values[index];
        const previous = states[key] ?? seed as bigint | undefined;
        let next: number | bigint = value;
        if (previous !== undefined) {
            if (typeof previous === 'number') {
                next = operator === '+' ? previous + value : operator === '*' ? previous * value
                    : operator === 'min' ? Math.min(previous, value) : Math.max(previous, value);
                if (!Number.isSafeInteger(next)) next = operator === '+' ? exact(previous) + BigInt(value)
                    : exact(previous) * BigInt(value);
            } else {
                const right = BigInt(value);
                next = operator === '+' ? previous + right : operator === '*' ? previous * right
                    : operator === 'min' ? previous < right ? previous : right : previous > right ? previous : right;
                const number = Number(next);
                if (Number.isSafeInteger(number)) next = number;
            }
        }
        states[key] = next;
        if (scan) output.push(exact(next));
    }
    if (scan) return ownedArray(output, shape);
    const result: RankValue[] = [];
    for (let key = 0; key < length; key++) {
        checkpoint('integer keyed fold');
        const state = states[key];
        if (state !== undefined) result.push(exact(state));
        else if (seed !== undefined) result.push(seed);
        else if (identity) result.push(identity());
        else throw new RankError('empty keyed group requires an initial value', 'MissingValueError');
    }
    return ownedArray(result);
}


/** Ordered Float64 folds retain the first extreme on ties, NaN and signed zero. */
function realKeyedFold(values: ArrayLike<number>, keys: Int32Array, shape: readonly number[],
    options: KeyedFoldOptions): RankArray {
    const { seed, identity, size, scan, operator } = options;
    const states: (number | undefined)[] = [];
    const output: RankValue[] = [];
    let length = size ?? 0;
    for (let index = 0; index < values.length; index++) {
        checkpoint('real keyed fold');
        const key = keys[index];
        if (key < 0) throw new RankError('by keys must be nonnegative integer array indices', 'TypeError');
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
