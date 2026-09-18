import { checkpoint, interruptibleValues } from './interrupt.js';
import { derivedArray, ownedArray, readArrayItem } from './array-storage.js';
import { MissingValueError, RankError } from './errors.js';
import {
    isRankArray,
    isRankQueue,
    isRankSequence,
    isRankSequenceMask,
    type RankArray,
    type RankSequence,
    type RankSequenceMask,
    type RankValue,
    type SequencePlan,
    type SequencePredicate,
    type SequenceSize,
} from './value.js';

export function sequence(plan: SequencePlan): RankSequence {
    return { kind: 'sequence', plan };
}

export function sequenceMask(
    source: RankSequence,
    predicate: SequencePredicate,
): RankSequenceMask {
    const mapped = mapSequence(source, predicate.name, value => predicate.test(value));
    return { kind: 'sequence', plan: mapped.plan, source, predicate };
}

export function filterSequence(
    source: RankSequence,
    predicate: SequencePredicate,
): RankSequence {
    const planned = source.plan.withFilter?.(predicate);
    if (planned) return sequence(planned);

    return sequence(filteredPlan(source.plan, predicate));
}

/**
 * A value bound and a filter keep the same items whichever order they run in,
 * so a filtered plan can offer the bounds its source offers. Without this a
 * selection over an endless source has nothing to stop it: `P (P multiple by 5)`
 * could not then be bounded by `until`.
 */
function filteredPlan(source: SequencePlan, predicate: SequencePredicate): SequencePlan {
    return {
        name: `${source.name} where ${predicate.name}`,
        singlePass: source.singlePass,
        size: filteredSize(source.size),
        *iterate() {
            for (const value of source.iterate()) {
                checkpoint('reading sequence');
                if (predicate.test(value)) yield value;
            }
        },
        ...(source.withUpperBound && {
            withUpperBound: (limit: bigint, inclusive: boolean) =>
                filteredPlan(source.withUpperBound!(limit, inclusive), predicate),
        }),
        ...(source.withLowerBound && {
            withLowerBound: (limit: bigint, inclusive: boolean) =>
                filteredPlan(source.withLowerBound!(limit, inclusive), predicate),
        }),
    };
}

export function boundSequence(
    source: RankSequence,
    limit: bigint,
    inclusive: boolean,
): RankSequence {
    const planned = source.plan.withUpperBound?.(limit, inclusive);
    if (!planned) {
        throw new RankError(`${source.plan.name} does not support ${inclusive ? 'to' : 'until'}`);
    }
    return sequence(planned);
}

export function lowerBoundSequence(
    source: RankSequence,
    limit: bigint,
    inclusive = true,
): RankSequence {
    const planned = source.plan.withLowerBound?.(limit, inclusive);
    if (!planned) {
        throw new RankError(`${source.plan.name} does not support from`);
    }
    return sequence(planned);
}

export function atSequence(source: RankSequence, index: bigint): RankValue {
    if (index < 0n) throw new MissingValueError('sequence index out of bounds');
    if (source.plan.size.kind === 'exact' && index >= source.plan.size.value) {
        throw new MissingValueError(`sequence index out of bounds: ${index}`);
    }

    const planned = source.plan.at?.(index);
    if (planned !== undefined) return planned;

    let current = 0n;
    for (const value of source.plan.iterate()) {
        checkpoint('reading sequence');
        if (current === index) return value;
        current += 1n;
    }
    throw new MissingValueError(`sequence index out of bounds: ${index}`);
}

/** Positional prefixes and tails; array views and sequence plans stay lazy. */
export function takeDropValue(source: RankValue, count: RankValue, drop = false): RankValue {
    const name = drop ? 'drop' : 'take';
    if (typeof count !== 'bigint' || count < 0n) {
        throw new RankError(`${name} expects a nonnegative integer count`);
    }
    if (typeof source === 'string') {
        const points = [...source];
        const offset = Number(count < BigInt(points.length) ? count : BigInt(points.length));
        return (drop ? points.slice(offset) : points.slice(0, offset)).join('');
    }
    if (isRankArray(source) && source.shape.length > 0) {
        const length = source.shape[0];
        const offset = Number(count < BigInt(length) ? count : BigInt(length));
        const cellSize = source.shape.slice(1).reduce((a, b) => a * b, 1);
        const shape = [drop ? length - offset : offset, ...source.shape.slice(1)];
        return derivedArray(shape, [source], index =>
            readArrayItem(source, index + (drop ? offset * cellSize : 0)));
    }
    if (!isRankSequence(source)) {
        throw new RankError(`${name} expects text, an array or a sequence`);
    }
    const plan = source.plan;
    const size: SequenceSize = plan.size.kind === 'exact'
        ? { kind: 'exact', value: drop
            ? (plan.size.value > count ? plan.size.value - count : 0n)
            : (plan.size.value < count ? plan.size.value : count) }
        : drop ? plan.size
            : plan.size.kind === 'infinite' || count === 0n
                ? { kind: 'exact', value: count }
                : { kind: 'unknown' };
    return sequence({
        name: `${plan.name} ${count} ${name}`,
        singlePass: plan.singlePass,
        captures: plan.captures,
        size,
        *iterate() {
            if (!drop && count === 0n) return;
            let remaining = count;
            for (const value of plan.iterate()) {
                checkpoint('reading sequence');
                if (drop) {
                    if (remaining > 0n) remaining -= 1n;
                    else yield value;
                } else {
                    yield value;
                    remaining -= 1n;
                    if (remaining === 0n) return;
                }
            }
        },
    });
}

export function mapSequence(
    source: RankSequence,
    name: string,
    operation: (value: RankValue) => RankValue,
): RankSequence {
    const sourcePlan = source.plan;
    return sequence({
        name: `${sourcePlan.name} ${name}`,
        singlePass: sourcePlan.singlePass,
        size: sourcePlan.size,
        *iterate() {
            for (const value of sourcePlan.iterate()) yield operation(value);
        },
    });
}

export function scanSequence(
    source: RankSequence,
    name: string,
    seed: RankValue | undefined,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankSequence {
    const sourcePlan = source.plan;
    return sequence({
        name: `${sourcePlan.name} ${name} scan`,
        singlePass: sourcePlan.singlePass,
        size: scanSize(sourcePlan.size, seed !== undefined),
        captures: sourcePlan.captures,
        *iterate() {
            let accumulated = seed;
            if (accumulated !== undefined) yield accumulated;
            for (const value of sourcePlan.iterate()) {
                accumulated = accumulated === undefined
                    ? value
                    : operation(accumulated, value);
                yield accumulated;
            }
        },
    });
}

export function firstWhereValue(
    source: RankValue,
    mask: RankValue,
    returnIndex = false,
): RankValue {
    validateAlignedSizes(source, mask, 'first where');
    if (isRankSequence(source) && isRankSequenceMask(mask) && mask.source === source) {
        let index = 0n;
        for (const value of source.plan.iterate()) {
            if (mask.predicate.test(value)) return returnIndex ? index : value;
            index += 1n;
        }
        throw new MissingValueError(`first${returnIndex ? ' index' : ''} where found no matching value`);
    }
    const values = rankOneValues(source, 'first where');
    const selected = maskValues(source, mask, 'first where');
    let index = 0n;
    while (true) {
        const value = values.next();
        const choice = selected.next();
        if (value.done || choice.done) {
            if (value.done !== choice.done) throw new RankError('first where source and mask have different lengths');
            break;
        }
        if (choice.value) return returnIndex ? index : value.value;
        index += 1n;
    }
    throw new MissingValueError(`first${returnIndex ? ' index' : ''} where found no matching value`);
}

export function takeWhileValue(source: RankValue, mask: RankValue): RankValue {
    validateAlignedSizes(source, mask, 'take while');
    if (isRankSequence(source)) {
        const sourcePlan = source.plan;
        return sequence({
            name: `${sourcePlan.name} take while`,
            singlePass: sourcePlan.singlePass,
            size: { kind: 'unknown' },
            captures: sourcePlan.captures,
            *iterate() {
                if (isRankSequenceMask(mask) && mask.source === source) {
                    for (const value of sourcePlan.iterate()) {
                        if (!mask.predicate.test(value)) return;
                        yield value;
                    }
                    return;
                }
                const values = rankOneValues(source, 'take while');
                const selected = maskValues(source, mask, 'take while');
                while (true) {
                    const value = values.next();
                    const choice = selected.next();
                    if (value.done || choice.done) {
                        if (value.done !== choice.done) {
                            throw new RankError('take while source and mask have different lengths');
                        }
                        return;
                    }
                    if (!choice.value) return;
                    yield value.value;
                }
            },
        });
    }

    const values = rankOneValues(source, 'take while');
    const selected = maskValues(source, mask, 'take while');
    const result: RankValue[] = [];
    while (true) {
        const value = values.next();
        const choice = selected.next();
        if (value.done || choice.done) {
            if (value.done !== choice.done) throw new RankError('take while source and mask have different lengths');
            break;
        }
        if (!choice.value) break;
        result.push(value.value);
    }
    return typeof source === 'string' ? result.join('') : ownedArray(result);
}

function* rankOneValues(value: RankValue, operation: string): IterableIterator<RankValue> {
    if (isRankArray(value)) {
        if (value.shape.length !== 1) throw new RankError(`${operation} expects a rank-1 source`);
        for (let index = 0; index < value.shape[0]; index += 1) {
            yield value.itemAt?.(index) ?? value.items[index];
        }
        return;
    }
    if (isRankQueue(value)) { yield* value.items; return; }
    if (typeof value === 'string') { yield* value; return; }
    if (isRankSequence(value)) { yield* value.plan.iterate(); return; }
    throw new RankError(`${operation} expects a rank-1 source`);
}

function* maskValues(
    source: RankValue,
    mask: RankValue,
    operation: string,
): IterableIterator<boolean> {
    if (isRankSequence(source) && isRankSequenceMask(mask) && mask.source === source) {
        for (const value of source.plan.iterate()) yield mask.predicate.test(value);
        return;
    }
    for (const value of rankOneValues(mask, operation)) {
        if (typeof value !== 'boolean') throw new RankError(`${operation} expects a boolean mask`);
        yield value;
    }
}

function validateAlignedSizes(source: RankValue, mask: RankValue, operation: string): void {
    const sourceSize = rankOneSize(source, operation);
    const maskSize = rankOneSize(mask, operation);
    if (sourceSize !== undefined && maskSize !== undefined && sourceSize !== maskSize) {
        throw new RankError(`${operation} mask length ${maskSize} does not match source length ${sourceSize}`);
    }
}

function rankOneSize(value: RankValue, operation: string): bigint | undefined {
    if (isRankArray(value)) {
        if (value.shape.length !== 1) throw new RankError(`${operation} expects a rank-1 source`);
        return BigInt(value.shape[0]);
    }
    if (isRankQueue(value)) return BigInt(value.items.length);
    if (typeof value === 'string') return BigInt([...value].length);
    if (isRankSequence(value)) {
        return value.plan.size.kind === 'exact' ? value.plan.size.value : undefined;
    }
    throw new RankError(`${operation} expects a rank-1 source`);
}

function scanSize(size: SequenceSize, seeded: boolean): SequenceSize {
    if (size.kind !== 'exact') return size;
    return { kind: 'exact', value: size.value + (seeded ? 1n : 0n) };
}

export function zipSequences(
    left: RankSequence,
    right: RankSequence,
    name: string,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankSequence {
    return sequence({
        name: `${left.plan.name} ${name} ${right.plan.name}`,
        singlePass: left.plan.singlePass || right.plan.singlePass,
        size: zippedSize(left.plan.size, right.plan.size),
        *iterate() {
            const a = left.plan.iterate();
            const b = right.plan.iterate();
            while (true) {
                const nextA = a.next();
                const nextB = b.next();
                if (nextA.done || nextB.done) return;
                yield operation(nextA.value, nextB.value);
            }
        },
    });
}

export function sequenceValues(value: RankValue, operation: string): Iterable<RankValue> {
    if (!isRankSequence(value)) return [value];
    if (value.plan.size.kind === 'infinite') {
        throw new RankError(`${operation} requires a bounded sequence`);
    }
    return { [Symbol.iterator]: () => interruptibleValues(value.plan.iterate(), operation)[Symbol.iterator]() };
}

export function materializeSequence(source: RankSequence): RankArray {
    if (source.plan.size.kind === 'infinite') {
        throw new RankError('cannot materialize an infinite sequence');
    }
    const items: RankValue[] = [];
    let cellShape: readonly number[] | undefined;
    let arrays: boolean | undefined;
    let count = 0;
    for (const value of interruptibleValues(source.plan.iterate(), 'materializing sequence')) {
        const array = isRankArray(value);
        arrays ??= array;
        if (arrays !== array) {
            throw new RankError('materialized sequence items must have the same shape', 'DimensionMismatch');
        }
        if (array) {
            cellShape ??= value.shape;
            if (cellShape.length !== value.shape.length
                || cellShape.some((size, axis) => size !== value.shape[axis])) {
                throw new RankError('materialized sequence items must have the same shape', 'DimensionMismatch');
            }
            const size = value.shape.reduce((product, dimension) => product * dimension, 1);
            for (let index = 0; index < size; index += 1) {
                checkpoint('materializing sequence');
                items.push(readArrayItem(value, index));
            }
        } else {
            items.push(value);
        }
        count += 1;
    }
    return ownedArray(items, [count, ...(cellShape ?? [])]);
}

export function reduceSequence(value: RankSequence, operation: string): RankValue | undefined {
    return value.plan.reduce?.(operation);
}

export function windowValue(
    source: RankValue,
    sizeValue: RankValue,
    axes?: readonly number[],
    strideValue?: RankValue,
    paddingValue?: RankValue,
): RankValue {
    const widths = windowWidths(sizeValue);
    if (widths.some(width => width <= 0)) {
        throw new RankError('window sizes must be positive integers');
    }
    const strides = windowGeometry(strideValue, widths.length, 'strides', 1);
    if (strides.some(stride => stride <= 0)) {
        throw new RankError('window strides must be positive integers');
    }
    const padding = windowGeometry(paddingValue, widths.length, 'padding', 0);
    if (padding.some(amount => amount < 0)) {
        throw new RankError('window padding must be nonnegative integers');
    }

    if (typeof source === 'string') {
        validateWindowAxes(1, widths, axes);
        rejectWindowPadding(padding, 'text');
        const atoms = [...source];
        const width = widths[0];
        const stride = strides[0];
        const count = windowCount(atoms.length, width, stride, 0);
        return sequence({
            name: `${width} window over text`,
            size: { kind: 'exact', value: BigInt(count) },
            *iterate() {
                for (let start = 0; start + width <= atoms.length; start += stride) {
                    yield atoms.slice(start, start + width).join('');
                }
            },
            at(index) {
                const start = Number(index) * stride;
                if (!Number.isSafeInteger(start) || start < 0 || start + width > atoms.length) {
                    return undefined;
                }
                return atoms.slice(start, start + width).join('');
            },
        });
    }

    if (isRankSequence(source)) {
        validateWindowAxes(1, widths, axes);
        rejectWindowPadding(padding, 'sequence');
        if (source.plan.size.kind !== 'exact') {
            return streamingWindows(source, widths[0], strides[0]);
        }
        const length = safeSize(source.plan.size.value, 'sequence size');
        const sourceItem = cachedSequenceItem(source);
        return arrayWindows(
            [length],
            sourceItem,
            widths,
            [0],
            strides,
            padding,
        );
    }

    if (isRankQueue(source)) {
        const items = [...source.items];
        validateWindowAxes(1, widths, axes);
        rejectWindowPadding(padding, 'queue');
        return arrayWindows(
            [items.length],
            index => items[index],
            widths,
            [0],
            strides,
            padding,
        );
    }

    if (!isRankArray(source)) {
        throw new RankError('window expects text, a sequence or an array');
    }
    const selectedAxes = validateWindowAxes(source.shape.length, widths, axes);
    return arrayWindows(
        source.shape,
        index => source.itemAt?.(index) ?? source.items[index],
        widths,
        selectedAxes,
        strides,
        padding,
        [source],
    );
}

function windowWidths(value: RankValue): number[] {
    const values = typeof value === 'bigint'
        ? [value]
        : isRankArray(value) && value.shape.length === 1
            ? value.items
            : undefined;
    if (!values || !values.every(item => typeof item === 'bigint')) {
        throw new RankError('window size must be an integer or a rank-1 integer array');
    }
    return values.map(item => safeSize(item as bigint, 'window size'));
}

function windowGeometry(
    value: RankValue | undefined,
    count: number,
    name: string,
    fallback: number,
): number[] {
    if (value === undefined) return Array(count).fill(fallback) as number[];
    const values = typeof value === 'bigint'
        ? Array(count).fill(value) as bigint[]
        : isRankArray(value) && value.shape.length === 1
            ? value.items
            : undefined;
    if (!values || !values.every(item => typeof item === 'bigint')) {
        throw new RankError(`window ${name} must be integers`);
    }
    if (values.length !== count) {
        throw new RankError(`window has ${count} size value but ${values.length} ${name}`);
    }
    return values.map(item => safeSize(item as bigint, `window ${name}`));
}

function rejectWindowPadding(padding: readonly number[], source: string): void {
    if (padding.some(amount => amount !== 0)) {
        throw new RankError(`window padding does not support ${source}`);
    }
}

function validateWindowAxes(
    rank: number,
    widths: readonly number[],
    axes: readonly number[] | undefined,
): readonly number[] {
    const selected = axes ?? (rank === 1 && widths.length === 1
        ? [0]
        : Array.from({ length: rank }, (_, index) => index));
    if (selected.length !== widths.length) {
        throw new RankError(
            `window has ${widths.length} size value but ${selected.length} selected axes`,
        );
    }
    if (new Set(selected).size !== selected.length) {
        throw new RankError('window axis numbers must be unique');
    }
    for (const axis of selected) {
        if (!Number.isSafeInteger(axis) || axis < 0 || axis >= rank) {
            throw new RankError(`window axis out of bounds: ${axis}`);
        }
    }
    return selected;
}

type CellFold = (start: number, operation: (a: RankValue, b: RankValue) => RankValue) => RankValue;
const windowCells = new WeakMap<RankArray, { size: number; fold: CellFold }>();

/** Compose a complete appended window cell with a left fold. No values are
 * cached or forced while selecting this path; readers keep their usual order. */
export function reduceWindowCell(
    value: RankArray, start: number, size: number,
    operation: (a: RankValue, b: RankValue) => RankValue,
): RankValue | undefined {
    const plan = windowCells.get(value);
    if (!plan || size !== plan.size || start % size !== 0) return undefined;
    return plan.fold(start / size, operation);
}

function arrayWindows(
    sourceShape: readonly number[],
    sourceItem: (index: number) => RankValue,
    widths: readonly number[],
    axes: readonly number[],
    strides: readonly number[],
    padding: readonly number[],
    dependencies?: readonly RankArray[],
): RankArray {
    const positionShape = [...sourceShape];
    const hasPadding = padding.some(amount => amount !== 0);
    axes.forEach((axis, index) => {
        positionShape[axis] = windowCount(
            sourceShape[axis],
            widths[index],
            strides[index],
            padding[index],
        );
    });
    const resultShape = [...positionShape, ...widths];
    const read = (linear: number): RankValue => {
        const output = arrayCoordinates(resultShape, linear);
        const input = output.slice(0, sourceShape.length);
        const offsets = output.slice(sourceShape.length);
        axes.forEach((axis, index) => {
            input[axis] = input[axis] * strides[index]
                - padding[index]
                + offsets[index];
        });
        if (hasPadding && input.some((coordinate, axis) =>
            coordinate < 0 || coordinate >= sourceShape[axis])) return 0n;
        return sourceItem(arrayOffset(sourceShape, input));
    };
    const result = dependencies ? derivedArray(resultShape, dependencies, read)
        : lazyArray(resultShape, read);

    const size = arraySize(widths);
    windowCells.set(result, { size, fold(frameIndex, operation) {
        if (sourceShape.length === 1 && widths.length === 1 && !hasPadding) {
            const start = frameIndex * strides[0];
            let answer = sourceItem(start);
            for (let index = 1; index < size; index++) {
                answer = operation(answer, sourceItem(start + index));
            }
            return answer;
        }
        const origin = arrayCoordinates(positionShape, frameIndex);
        axes.forEach((axis, index) => {
            origin[axis] = origin[axis] * strides[index] - padding[index];
        });
        const coordinates = [...origin];
        const cell = Array(widths.length).fill(0) as number[];
        // Use current source geometry, just as the ordinary window reader does.
        const sourceStrides = sourceShape.map(() => 1);
        for (let axis = sourceShape.length - 2; axis >= 0; axis--) {
            sourceStrides[axis] = sourceStrides[axis + 1] * sourceShape[axis + 1];
        }
        let offset = arrayOffset(sourceShape, coordinates);
        const read = () => hasPadding && coordinates.some((coordinate, axis) =>
            coordinate < 0 || coordinate >= sourceShape[axis]) ? 0n : sourceItem(offset);
        let answer = read();
        for (let index = 1; index < size; index++) {
            for (let axis = widths.length - 1; axis >= 0; axis--) {
                const sourceAxis = axes[axis];
                cell[axis]++;
                coordinates[sourceAxis]++;
                offset += sourceStrides[sourceAxis];
                if (cell[axis] < widths[axis]) break;
                cell[axis] = 0;
                coordinates[sourceAxis] -= widths[axis];
                offset -= widths[axis] * sourceStrides[sourceAxis];
            }
            answer = operation(answer, read());
        }
        return answer;
    } });
    return result;
}

function windowCount(length: number, width: number, stride: number, padding: number): number {
    const available = length + padding * 2 - width;
    return available < 0 ? 0 : Math.floor(available / stride) + 1;
}

function streamingWindows(
    source: RankSequence,
    width: number,
    stride: number,
): RankSequence {
    const sourceSize = source.plan.size;
    const size = sourceSize.kind === 'infinite'
        ? sourceSize
        : { kind: 'unknown' as const };
    return sequence({
        name: `${width} window over ${source.plan.name}`,
        size,
        *iterate() {
            const buffer: RankValue[] = [];
            let start = 0;
            for (const value of source.plan.iterate()) {
                checkpoint('reading sequence');
                buffer.push(value);
                if (buffer.length < width) continue;
                if (buffer.length > width) buffer.shift();
                if (start % stride === 0) {
                    yield { kind: 'array', items: [...buffer], shape: [width] };
                }
                start += 1;
            }
        },
    });
}

function cachedSequenceItem(source: RankSequence): (index: number) => RankValue {
    const iterator = source.plan.iterate();
    const items: RankValue[] = [];
    return index => {
        while (items.length <= index) {
            const next = iterator.next();
            if (next.done) throw new MissingValueError(`sequence index out of bounds: ${index}`);
            items.push(next.value);
        }
        return items[index];
    };
}

function lazyArray(shape: readonly number[], itemAt: (index: number) => RankValue): RankArray {
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape,
        itemAt,
        get items() {
            materialized ??= Array.from({ length: arraySize(shape) }, (_, index) => itemAt(index));
            return materialized;
        },
    };
}

function arrayCoordinates(shape: readonly number[], linear: number): number[] {
    const result = Array(shape.length).fill(0) as number[];
    for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
        result[axis] = linear % shape[axis];
        linear = Math.floor(linear / shape[axis]);
    }
    return result;
}

function arrayOffset(shape: readonly number[], coordinates: readonly number[]): number {
    return coordinates.reduce((offset, coordinate, axis) => offset * shape[axis] + coordinate, 0);
}

function arraySize(shape: readonly number[]): number {
    return shape.reduce((product, dimension) => product * dimension, 1);
}

function safeSize(value: bigint, name: string): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RankError(`${name} is too large: ${value}`);
    return Number(value);
}

function filteredSize(size: SequenceSize): SequenceSize {
    return size.kind === 'infinite' ? size : { kind: 'unknown' };
}

function zippedSize(left: SequenceSize, right: SequenceSize): SequenceSize {
    if (left.kind === 'exact' && right.kind === 'exact') {
        return { kind: 'exact', value: left.value < right.value ? left.value : right.value };
    }
    if (left.kind === 'exact' && right.kind === 'infinite') return left;
    if (right.kind === 'exact' && left.kind === 'infinite') return right;
    if (left.kind === 'infinite' && right.kind === 'infinite') return left;
    return { kind: 'unknown' };
}
