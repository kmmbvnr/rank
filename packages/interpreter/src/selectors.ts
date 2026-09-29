import { denseScalarItems, derivedArray, ownedArray, readArrayItem } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { MissingValueError, RankError } from './errors.js';
import { atSequence, sequenceValues } from './sequence.js';
import { arrayOffset, coordinatesAt, safeDimension } from './tensor-index.js';
import { isRankArray, isRankQueue, isRankSequence, typeName,
    type RankArray, type RankValue } from './value.js';

export const ALL_AXIS = { kind: 'label', name: '#' } as const;
const arrayItem = readArrayItem;
const arraySize = (shape: readonly number[]): number =>
    shape.reduce((product, dimension) => product * dimension, 1);
const array = (items: RankValue[]): RankArray => ownedArray(items);

// A large slice of stored scalars is copied at once. A lazy slice would cache
// each cell in a Map, several times the size of the cells themselves.
const DENSE_SLICE_CELLS = 1 << 16;

interface TensorSelection {
    readonly shape: readonly number[];
    offsetAt(index: number): number;
}

function isAllAxisSelector(value: RankValue): boolean {
    return value === ALL_AXIS;
}

export function isTensorAddress(selectors: readonly RankValue[]): boolean {
    if (selectors.length === 0) return false;
    if (!selectors.every(selector =>
        isAllAxisSelector(selector)
        || typeof selector === 'bigint'
        || isCollectionSelector(selector))) return false;
    return selectors.some(isAllAxisSelector)
        || (selectors.length > 1 && selectors.some(isCollectionSelector));
}

/** Full scalar addresses are guaranteed by the integer-region entry guards.
 * Keep write bounds in BigInt space, as in tensorSelection, without building
 * per-axis selector closures or an output-shape plan for a single cell. */
export function scalarArrayWriteOffset(source: RankArray, indices: readonly bigint[]): number {
    const shape = source.shape;
    let offset = 0;
    for (let axis = 0; axis < indices.length; axis++) {
        const index = indices[axis], size = shape[axis];
        if (index < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
        if (index >= BigInt(size)) {
            throw new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`);
        }
        offset = offset * size + Number(index);
    }
    return offset;
}

export function tensorSelection(source: RankArray, selectors: readonly RankValue[]): TensorSelection {
    if (selectors.length > source.shape.length) {
        throw new RankError(`array expects at most ${source.shape.length} selectors`);
    }
    const axes = source.shape.map((size, axis) => {
        const selector = selectors[axis] ?? ALL_AXIS;
        if (isAllAxisSelector(selector)) {
            return { preserve: true, size, indexAt: (coordinate: number) => coordinate };
        }
        if (typeof selector === 'bigint') {
            if (selector < 0n) {
                throw new RankError(`array index must be nonnegative on axis ${axis}`);
            }
            if (selector >= BigInt(size)) {
                throw new MissingValueError(`array index out of bounds on axis ${axis}: ${selector}`);
            }
            return { preserve: false, size: 1, indexAt: () => Number(selector) };
        }
        if (typeof selector === 'number') {
            throw new RankError(`array index must be an integer on axis ${axis}`);
        }
        const indices = selectorIndices(selector, size, axis);
        return {
            preserve: true,
            size: indices.length,
            indexAt: (coordinate: number) => indices[coordinate],
        };
    });
    const shape = axes.filter(axis => axis.preserve).map(axis => axis.size);
    // A vector selection is already a linear mapping. Avoid rebuilding a
    // one-coordinate tensor address for every selected item; gather-heavy
    // loops use this path for both boolean masks and integer index vectors.
    if (axes.length === 1) {
        const axis = axes[0];
        return {
            shape,
            offsetAt(index) { return axis.indexAt(axis.preserve ? index : 0); },
        };
    }
    return {
        shape,
        offsetAt(index) {
            const output = coordinatesAt(shape, index);
            let outputAxis = 0;
            const sourceCoordinates = axes.map(axis => {
                if (!axis.preserve) return axis.indexAt(0);
                return axis.indexAt(output[outputAxis++]);
            });
            return arrayOffset(source.shape, sourceCoordinates);
        },
    };
}

export function atArray(source: RankArray, indices: readonly bigint[]): RankValue {
    const shape = source.shape;
    if (indices.length > shape.length) {
        throw new RankError(`array expects at most ${shape.length} indices`);
    }
    // Accumulating the offset one axis at a time keeps the walk free of the
    // per-axis stride slice, which allocated on every element read.
    let offset = 0;
    for (let axis = 0; axis < indices.length; axis += 1) {
        const index = indices[axis];
        const size = shape[axis];
        if (index < 0n) throw new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`);
        const position = Number(index);
        if (position >= size) {
            throw new MissingValueError(`array index out of bounds on axis ${axis}: ${index}`);
        }
        offset = offset * size + position;
    }
    for (let axis = indices.length; axis < shape.length; axis += 1) offset *= shape[axis];
    if (indices.length === shape.length) return arrayItem(source, offset);
    const rest = shape.slice(indices.length);
    return derivedArray(rest, [source], index => arrayItem(source, offset + index));
}

/** The cells a selection addresses: an array, or the one cell of an empty shape. */
export function sliceArray(
    source: RankArray, selection: { shape: readonly number[]; offsetAt(index: number): number },
): RankValue {
    if (selection.shape.length === 0) return arrayItem(source, selection.offsetAt(0));
    const stored = denseScalarItems(source);
    const total = arraySize(selection.shape);
    if (stored && total >= DENSE_SLICE_CELLS) {
        const cells: RankValue[] = new Array(total);
        for (let index = 0; index < total; index += 1) {
            if ((index & 0xfff) === 0) checkpoint('computing array');
            cells[index] = stored[selection.offsetAt(index)];
        }
        return ownedArray(cells, selection.shape, true);
    }
    return derivedArray(selection.shape, [source], index => arrayItem(source, selection.offsetAt(index)));
}

export function selectAxis(source: RankValue, axis: number, selector: RankValue): RankValue {
    const size = axisSize(source, axis);
    if (isRankArray(source)) {
        const selectors = Array(axis).fill(ALL_AXIS) as RankValue[];
        selectors.push(selector);
        const selection = tensorSelection(source, selectors);
        return sliceArray(source, selection);
    }
    if (typeof selector === 'bigint') {
        if (selector < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
        if (selector >= BigInt(size)) {
            throw new MissingValueError(`array index out of bounds on axis ${axis}: ${selector}`);
        }
        if (typeof source === 'string') return [...source][Number(selector)];
        if (isRankSequence(source)) return atSequence(source, selector);
        if (isRankQueue(source)) return source.items[Number(selector)];
    }
    const indices = selectorIndices(selector, size, axis);
    if (typeof source === 'string') {
        const atoms = [...source];
        return indices.map(index => atoms[index]).join('');
    }
    if (isRankSequence(source)) {
        return array(indices.map(index => atSequence(source, BigInt(index))));
    }
    if (!isRankQueue(source)) throw new RankError(`selection does not accept ${typeName(source)}`);
    return array(indices.map(index => source.items[index]));
}

export function axisSize(source: RankValue, axis: number): number {
    if (typeof source === 'string') {
        if (axis !== 0) throw new RankError(`text has no axis ${axis}`);
        return [...source].length;
    }
    if (isRankSequence(source)) {
        if (axis !== 0) throw new RankError(`sequence has no axis ${axis}`);
        if (source.plan.size.kind !== 'exact') {
            throw new RankError('sequence selection requires an exact finite size');
        }
        return safeDimension(source.plan.size.value, 'sequence size');
    }
    if (isRankQueue(source)) {
        if (axis !== 0) throw new RankError(`queue has no axis ${axis}`);
        return source.items.length;
    }
    if (!isRankArray(source)) throw new RankError(`selection does not accept ${typeName(source)}`);
    if (axis >= source.shape.length) throw new RankError(`array has no axis ${axis}`);
    return source.shape[axis];
}

function selectorIndices(selector: RankValue, size: number, axis: number): number[] {
    if (isRankArray(selector) && selector.shape.length !== 1) {
        throw new RankError('axis selector must have rank 1');
    }
    const count = isRankArray(selector)
        ? arraySize(selector.shape)
        : isRankQueue(selector)
            ? selector.items.length
            : undefined;
    const values = count === undefined && isRankSequence(selector)
        ? [...sequenceValues(selector, 'selection')]
        : undefined;
    if (count === undefined && values === undefined) {
        throw new RankError('selection expects an array, queue or finite sequence');
    }
    const length = count ?? values!.length;
    if (length === 0) return [];
    const at = isRankArray(selector)
        ? (index: number) => arrayItem(selector, index)
        : isRankQueue(selector)
            ? (index: number) => selector.items[index]
            : (index: number) => values![index];
    const boolean = typeof at(0) === 'boolean';
    if (boolean && length !== size) {
        throw new RankError(`mask length ${length} does not match axis ${axis} size ${size}`);
    }
    const result: number[] = [];
    for (let position = 0; position < length; position += 1) {
        const value = at(position);
        if (boolean) {
            if (typeof value !== 'boolean') {
                throw new RankError('axis selector must contain only integers or only booleans');
            }
            if (value) result.push(position);
            continue;
        }
        if (typeof value !== 'bigint') {
            throw new RankError('axis selector must contain only integers or only booleans');
        }
        if (value < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
        if (value >= BigInt(size)) {
            throw new MissingValueError(`array index out of bounds on axis ${axis}: ${value}`);
        }
        result.push(Number(value));
    }
    return result;
}

export function isCollectionSelector(value: RankValue): boolean {
    return isRankArray(value) || isRankQueue(value) || isRankSequence(value);
}

export function isIntegerCollectionSelector(value: RankValue): boolean {
    if (isRankSequence(value)) return true;
    if (!isRankArray(value) && !isRankQueue(value)) return false;
    return value.items.every(item => typeof item === 'bigint');
}

