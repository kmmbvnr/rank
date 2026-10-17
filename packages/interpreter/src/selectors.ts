import { indexedSource } from './indexed-source.js';
import { inheritSemanticArrayType } from './semantic-array-type.js';
import { registerIntegerView } from './integer-view.js';
import { positionalValue } from './positional-value.js';
import { denseScalarItems, derivedArray, ownedArray, readArrayItem, readCellOrMissing, realCells, retainSelectionSnapshot, typedArray, typedElementKind } from './array-storage.js';
import { checkpoint } from './interrupt.js';
import { MissingValueError, RankError } from './errors.js';
import { sequenceValues } from './sequence.js';
import { arrayOffset, coordinatesAt } from './tensor-index.js';
import { isRankArray, isRankQueue, isRankSequence, typeName,
    MISSING, type RankArray, type RankValue } from './value.js';

export const ALL_AXIS = { kind: 'label', name: '#' } as const;
const arrayItem = readArrayItem;
const arraySize = (shape: readonly number[]): number =>
    shape.reduce((product, dimension) => product * dimension, 1);

// Large scalar slices are gathered eagerly to avoid a per-cell Map cache.
const DENSE_SLICE_CELLS = 1 << 16;

function selectionArray(shape: readonly number[], source: RankArray, offsetAt: (index: number) => number): RankArray {
    let current = source;
    let position = offsetAt;
    const dependencies = [source];
    const result = derivedArray(shape, dependencies, index => arrayItem(current, position(index)));
    registerIntegerView(result, () => current, index => position(index));
    retainSelectionSnapshot(result, source, offsetAt, snapshot => {
        current = snapshot;
        position = index => index;
        dependencies[0] = snapshot;
    });
    return result;
}

interface SelectedAxis {
    readonly preserve: boolean;
    readonly size: number;
    indexAt(coordinate: number): number;
}

interface TensorSelection {
    readonly shape: readonly number[];
    offsetAt(index: number): number;
    /** The per-axis plan behind `offsetAt`, when there is one. */
    readonly axes?: readonly SelectedAxis[];
    readonly sourceShape?: readonly number[];
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
        shape, axes, sourceShape: source.shape,
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
    if (source.columnNames && shape.length === 2 && indices.length === 1) {
        return positionalValue(Array.from({ length: shape[1] }, (_, column) => arrayItem(source, offset + column)));
    }
    const rest = shape.slice(indices.length);
    // A row of a typed array is one contiguous run of its buffer.
    const kind = typedElementKind(source);
    const stored = kind ? denseScalarItems(source) as Float64Array | BigInt64Array : undefined;
    if (stored) {
        const length = arraySize(rest);
        return inheritSemanticArrayType(source, typedArray(stored.slice(offset, offset + length), rest));
    }
    return inheritSemanticArrayType(source, selectionArray(rest, source, index => offset + index));
}

/** The cells a selection addresses: an array, or the one cell of an empty shape. */
export function sliceArray(
    source: RankArray, selection: TensorSelection,
): RankValue {
    if (selection.shape.length === 0) return arrayItem(source, selection.offsetAt(0));
    const columnAxis = source.columnNames && source.shape.length === 2 ? selection.axes?.[1] : undefined;
    if (columnAxis?.preserve && selection.axes?.[0].preserve === false) {
        return positionalValue(Array.from({ length: columnAxis.size }, (_, column) => arrayItem(source, selection.offsetAt(column))));
    }
    const columnNames = columnAxis?.preserve && selection.shape.length === 2
        ? Array.from({ length: columnAxis.size }, (_, column) => source.columnNames![columnAxis.indexAt(column)]) : undefined;
    const stored = denseScalarItems(source);
    const total = arraySize(selection.shape);
    // Typed and large plain slices are gathered eagerly. Smaller slices stay
    // lazy, detaching their selected cells only before a Rank source write.
    const kind = typedElementKind(source);
    if (stored && (kind !== undefined || total >= DENSE_SLICE_CELLS)) {
        const reals = kind === 'real' || (kind === undefined && realCells(source) !== undefined);
        const out: RankValue[] | Float64Array | BigInt64Array = reals ? new Float64Array(total)
            : kind === 'integer' ? new BigInt64Array(total) : new Array(total);
        gather(stored, out as unknown as RankValue[], selection, total);
        const result = Array.isArray(out) ? ownedArray(out, selection.shape, true, columnNames) : typedArray(out, selection.shape, columnNames);
        return source.columnNames ? result : inheritSemanticArrayType(source, result);
    }
    const result = selectionArray(selection.shape, source, selection.offsetAt);
    if (columnNames) Object.defineProperty(result, 'columnNames', { value: columnNames });
    return source.columnNames ? result : inheritSemanticArrayType(source, result);
}

/** Copy the selected cells in output order. With a per-axis plan the source
 * offset is stepped like an odometer instead of decoded for every cell. */
function gather(
    stored: ArrayLike<RankValue>, out: RankValue[], selection: TensorSelection, total: number,
): void {
    const { axes, sourceShape } = selection;
    if (!axes || !sourceShape) {
        for (let index = 0; index < total; index += 1) {
            if ((index & 0xfff) === 0) checkpoint('computing array');
            out[index] = stored[selection.offsetAt(index)];
        }
        return;
    }
    const strides = new Array<number>(sourceShape.length).fill(1);
    for (let axis = sourceShape.length - 2; axis >= 0; axis -= 1) strides[axis] = strides[axis + 1] * sourceShape[axis + 1];
    let fixed = 0;
    const kept: { size: number; stride: number; indexAt: (coordinate: number) => number }[] = [];
    axes.forEach((axis, position) => {
        if (axis.preserve) kept.push({ size: axis.size, stride: strides[position], indexAt: axis.indexAt });
        else fixed += axis.indexAt(0) * strides[position];
    });
    const rank = kept.length;
    const coordinates = new Array<number>(rank).fill(0);
    const contribution = kept.map(axis => axis.indexAt(0) * axis.stride);
    let offset = fixed + contribution.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < total; index += 1) {
        if ((index & 0xfff) === 0) checkpoint('computing array');
        out[index] = stored[offset];
        for (let position = rank - 1; position >= 0; position -= 1) {
            const axis = kept[position];
            coordinates[position] += 1;
            if (coordinates[position] >= axis.size) coordinates[position] = 0;
            const next = axis.indexAt(coordinates[position]) * axis.stride;
            offset += next - contribution[position];
            contribution[position] = next;
            if (coordinates[position] !== 0) break;
        }
    }
}

export function selectAxis(source: RankValue, axis: number, selector: RankValue): RankValue {
    const access = indexedSource(source);
    if (!access) throw new RankError(`selection does not accept ${typeName(source)}`);
    const open = isRankSequence(selector) ? selector.plan.openRange : undefined;
    const openResult = open ? access.openSlice?.(open.start, open.step, axis) : undefined;
    if (openResult !== undefined) return openResult;
    const size = access.axisSize(axis);
    if (access.tensor) {
        const selectors = Array(axis).fill(ALL_AXIS) as RankValue[];
        selectors.push(selector);
        return sliceArray(access.tensor, tensorSelection(access.tensor, selectors));
    }
    if (typeof selector === 'bigint') {
        if (selector < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
        if (selector >= BigInt(size)) throw new MissingValueError(`array index out of bounds on axis ${axis}: ${selector}`);
        return access.at(selector);
    }
    const indices = selectorIndices(selector, size, axis);
    return access.build(indices.map(index => access.at(BigInt(index))));
}

export function axisSize(source: RankValue, axis: number): number {
    const access = indexedSource(source);
    if (!access) throw new RankError(`selection does not accept ${typeName(source)}`);
    return access.axisSize(axis);
}

function selectorIndices(selector: RankValue, size: number, axis: number): number[] {
    const open = isRankSequence(selector) ? selector.plan.openRange : undefined;
    if (open) {
        if (open.start < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
        if (open.start > BigInt(size)) throw new MissingValueError(`array index out of bounds on axis ${axis}: ${open.start}`);
        const indices: number[] = [];
        if (open.start === BigInt(size)) return indices;
        for (let i = open.start; i >= 0n && i < BigInt(size); i += open.step) indices.push(Number(i));
        return indices;
    }
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
    const stored = isRankArray(selector) ? denseScalarItems(selector) : undefined;
    const at = stored ? (index: number) => stored[index] : isRankArray(selector)
        ? (index: number) => readCellOrMissing(selector, index)
        : isRankQueue(selector)
            ? (index: number) => selector.items[index]
            : (index: number) => values![index];
    // A cell with no value in a mask is not selected, as in SQL.
    let lead = at(0);
    for (let position = 1; lead === MISSING && position < length; position += 1) lead = at(position);
    const boolean = typeof lead === 'boolean' || lead === MISSING;
    if (boolean && length !== size) {
        throw new RankError(`mask length ${length} does not match axis ${axis} size ${size}`);
    }
    const result: number[] = [];
    for (let position = 0; position < length; position += 1) {
        const value = at(position);
        if (boolean) {
            if (value === MISSING) continue;
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
    const stored = isRankArray(value) ? denseScalarItems(value) : undefined;
    return stored ? Array.prototype.every.call(stored, (item: RankValue) => typeof item === 'bigint')
        : value.items.every(item => typeof item === 'bigint');
}

