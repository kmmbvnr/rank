import { resolveAxis } from './tensor-index.js';
import { registerArrayCopy, copyStoredArrayBlocks } from './array-copy.js';
import { registerPackedBooleanSelection } from './packed-booleans.js';
import type { ArrayCellRead } from './array-cell-read.js';
import { framedArray } from './framed-array.js';
import { permutedArray } from './array-permutation.js';
import { arithmeticRange } from './range-plan.js';
import { indexedSource } from './indexed-source.js';
import { inheritSemanticArrayType, semanticArrayType } from './semantic-array-type.js';
import { registerScalarView, deferSelectionCopy, prepareIntegerRange, type LinearView } from './integer-view.js';
import { positionalValue } from './positional-value.js';
import { materializeTensorMap } from './tensor-map.js';
import { arrayCells, arrayFrameAxes, registerArrayDependencies, denseScalarItems, derivedArray, integer32Cells, ownedArray, readArrayItem, readCellOrMissing, realCells, retainSelectionSnapshot, sliceStoredArray, storedScalarKinds, typedArray, typedElementKind } from './array-storage.js';
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

// Large irregular scalar gathers avoid a per-cell Map cache.
const DENSE_SLICE_CELLS = 1 << 16;

function selectionArray(shape: readonly number[], source: RankArray, offsetAt: (index: number) => number, linear?: LinearView, regular = linear !== undefined, blockSize = 1): RankArray {
    let current = source;
    let position = offsetAt;
    const dependencies = [source];
    const result = derivedArray(shape, dependencies, index => arrayItem(current, position(index)));
    registerScalarView(result, () => current, index => position(index), { regular,
        capture: () => ({ source: current, offset: position }),
        linear: linear ? () => linear! : undefined });
    retainSelectionSnapshot(result, source, offsetAt, snapshot => {
        current = snapshot;
        position = index => index;
        linear = { offset: 0, stride: 1 };
        dependencies[0] = snapshot;
    });
    registerArrayCopy(result, () => {
        const total = arraySize(shape);
        if (linear?.stride === 1) {
            const shared = sliceStoredArray(current, linear.offset, shape);
            if (shared) return shared;
        }
        const run = linear?.stride === 1 ? total : blockSize;
        if (run <= 1 || total === 0) return undefined;
        return copyStoredArrayBlocks(shape, [current], function* () {
            for (let target = 0; target < total; target += run) {
                yield { source: current, offset: position(target), length: run, target };
            }
        });
    });
    registerPackedBooleanSelection(result, () => current, () => linear?.stride === 1 ? linear.offset : undefined);
    return result;
}

interface SelectedAxis {
    readonly preserve: boolean;
    readonly size: number;
    /** An integer array replaces this source axis with its entire frame. */
    readonly shape?: readonly number[];
    readonly unique?: boolean;
    indexAt(coordinate: number): number;
    readonly linear?: LinearView;
}

interface TensorSelection {
    /** True only for selectors proved to contain no repeated offsets. */
    readonly unique?: boolean;
    readonly shape: readonly number[];
    offsetAt(index: number): number;
    /** The per-axis plan behind `offsetAt`, when there is one. */
    readonly axes?: readonly SelectedAxis[];
    readonly sourceShape?: readonly number[];
    readonly linear?: LinearView;
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
        let selector = selectors[axis] ?? ALL_AXIS;
        if (isAllAxisSelector(selector)) {
            return { preserve: true, size, unique: true, linear: { offset: 0, stride: 1 }, indexAt: (coordinate: number) => coordinate };
        }
        if (typeof selector === 'bigint') {
            if (selector < 0n) {
                throw new RankError(`array index must be nonnegative on axis ${axis}`);
            }
            if (selector >= BigInt(size)) {
                throw new MissingValueError(`array index out of bounds on axis ${axis}: ${selector}`);
            }
            return { preserve: false, size: 1, linear: { offset: Number(selector), stride: 0 }, indexAt: () => Number(selector) };
        }
        if (typeof selector === 'number') {
            throw new RankError(`array index must be an integer on axis ${axis}`);
        }
        const open = isRankSequence(selector) && selector.plan.openRange;
        if (open) {
            if (open.start < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
            if (open.start > BigInt(size)) throw new MissingValueError(`array index out of bounds on axis ${axis}: ${open.start}`);
            const count = open.start === BigInt(size) ? 0n : open.step > 0n
                ? (BigInt(size) - 1n - open.start) / open.step + 1n : open.start / -open.step + 1n;
            const offset = count ? Number(open.start) : 0, stride = count > 1n ? Number(open.step) : 1;
            return { preserve: true, size: Number(count), unique: true, linear: { offset, stride },
                indexAt: (coordinate: number) => offset + coordinate * stride };
        }
        const range = isRankSequence(selector) ? arithmeticRange(selector.plan)
            : isRankArray(selector) ? prepareIntegerRange(selector) : undefined;
        if (range) {
            const { start, step, count } = range;
            if (count > 0n) {
                if (start < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
                if (start >= BigInt(size)) throw new MissingValueError(`array index out of bounds on axis ${axis}: ${start}`);
                const last = start + (count - 1n) * step;
                if (last < 0n) throw new RankError(`array index must be nonnegative on axis ${axis}`);
                if (last >= BigInt(size)) {
                    const firstBad = start + ((BigInt(size) - start + step - 1n) / step) * step;
                    throw new MissingValueError(`array index out of bounds on axis ${axis}: ${firstBad}`);
                }
            }
            const linear = { start: count ? Number(start) : 0, step: count > 1n ? Number(step) : 1 };
            return { preserve: true, size: Number(count), unique: count <= 1n || step !== 0n, linear: { offset: linear.start, stride: linear.step }, indexAt: (coordinate: number) => linear.start + coordinate * linear.step };
        }
        // Addressing consumes the whole selector before the RHS or any write.
        // Native arithmetic can complete that demand as one numeric kernel;
        // opaque readers and failing recipes retain the ordinary cell path.
        if (isRankArray(selector) && selector.itemAt !== undefined) {
            selector = materializeTensorMap(selector) ?? selector;
        }
        // Trusted dense integer selectors can be checked into one compact
        // offset buffer. No getters, lazy cells or semantic contracts are read.
        const shape = isRankArray(selector) ? selector.shape : undefined;
        const stored = isRankArray(selector) ? denseScalarItems(selector) : undefined;
        const kinds = stored && storedScalarKinds(selector as RankArray);
        if (stored && kinds?.length === 1 && kinds[0] === 'integer') {
            const compact = integer32Cells(selector as RankArray);
            // Materialized ranges retain their affine addressing. Prove it from
            // trusted cells; an arbitrary index vector still uses the gather.
            if (shape?.length === 1) {
                const count = stored.length;
                const first = count ? Number(compact ? compact[0] : stored[0]) : 0;
                const stride = count > 1 ? Number(compact ? compact[1] : stored[1]) - first : 1;
                let regular = true;
                for (let i = 0; i < count; i++) {
                    if ((i & 4095) === 0) checkpoint('checking linear array indices', Math.min(4096, count - i));
                    if (Number(compact ? compact[i] : stored[i]) !== first + i * stride) { regular = false; break; }
                }
                const last = first + (count - 1) * stride;
                if (regular && (!count || Math.min(first, last) >= 0 && Math.max(first, last) < size)) {
                    return { preserve: true, size: count, shape, unique: count <= 1 || stride !== 0,
                        linear: { offset: first, stride }, indexAt: (coordinate: number) => first + coordinate * stride };
                }
            }
            const indices = new Float64Array(stored.length);
            let unique = true;
            for (let i = 0; i < indices.length; i++) {
                checkpoint('checking array indices');
                const value = compact ? compact[i] : stored[i] as bigint;
                const offset = Number(value);
                if (offset < 0) throw new RankError(`array index must be nonnegative on axis ${axis}`);
                if (offset >= size) throw new MissingValueError(`array index out of bounds on axis ${axis}: ${value}`);
                indices[i] = offset;
                if (i > 0 && offset <= indices[i - 1]) unique = false;
            }
            return { preserve: true, size: indices.length, shape, unique, indexAt: (coordinate: number) => indices[coordinate] };
        }
        const indices = selectorIndices(selector, size, axis);
        return {
            preserve: true,
            size: indices.length,
            shape: shape && shape.length !== 1 ? shape : undefined,
            unique: indices.every((offset, index) => index === 0 || offset > indices[index - 1]),
            indexAt: (coordinate: number) => indices[coordinate],
        };
    });
    return selectionFromAxes(source.shape, axes);
}

function selectedAxisShape(axis: SelectedAxis): readonly number[] {
    return axis.preserve ? axis.shape ?? [axis.size] : [];
}

function selectionFromAxes(sourceShape: readonly number[], axes: readonly SelectedAxis[]): TensorSelection {
    const shape = axes.flatMap(axis => [...selectedAxisShape(axis)]);
    // Flatten each selector frame only for offset arithmetic. The public
    // shape retains all its dimensions, including empty dimensions.
    const indexShape = axes.filter(axis => axis.preserve).map(axis => axis.size);
    // A vector selection is already a linear mapping. Avoid rebuilding a
    // one-coordinate tensor address for every selected item; gather-heavy
    // loops use this path for both boolean masks and integer index vectors.
    if (axes.length === 1) {
        const axis = axes[0];
        return {
            shape, axes, sourceShape, unique: axis.unique, linear: axis.linear,
            offsetAt: axis.indexAt,
        };
    }
    return {
        shape, axes, sourceShape, linear: linearSelection(axes, sourceShape),
        offsetAt(index) {
            const output = coordinatesAt(indexShape, index);
            let outputAxis = 0;
            const sourceCoordinates = axes.map(axis => {
                if (!axis.preserve) return axis.indexAt(0);
                return axis.indexAt(output[outputAxis++]);
            });
            return arrayOffset(sourceShape, sourceCoordinates);
        },
    };
}

/** A regular tensor selection is flat when its retained axes advance by
 * one constant stride in output order (including a leading-axis slice). */
function linearSelection(axes: readonly SelectedAxis[], sourceShape: readonly number[]): LinearView | undefined {
    if (axes.some(axis => !axis.linear)) return undefined;
    if (axes.some(axis => axis.preserve && axis.size === 0)) return { offset: 0, stride: 1 };
    let sourceStride = 1, outputStride = 1, offset = 0;
    let stride: number | undefined;
    for (let i = axes.length - 1; i >= 0; i--) {
        const axis = axes[i], linear = axis.linear!;
        offset += linear.offset * sourceStride;
        if (axis.preserve) {
            if (axis.size > 1) {
                const advance = linear.stride * sourceStride;
                stride ??= advance / outputStride;
                if (advance !== stride * outputStride) return undefined;
            }
            outputStride *= axis.size;
        }
        sourceStride *= sourceShape[i];
    }
    return { offset, stride: stride ?? 1 };
}

/** Select producer cells before flattening their zero-sized trailing axes. */
function producerSelection(source: RankArray, selection: TensorSelection, observation?: ArrayCellRead): RankValue | undefined {
    const cells = arrayCells(source);
    const axes = selection.axes;
    const cellShape = cells?.cellShape();
    if (!cells || !axes || !cellShape || cells.frameShape.length + cellShape.length !== axes.length) return undefined;
    const framePositions = arrayFrameAxes(cells);
    const cellPositions = axes.map((_, axis) => axis).filter(axis => !framePositions.includes(axis));
    const frameAxes = framePositions.map(axis => axes[axis]);
    const cellAxes = cellPositions.map(axis => axes[axis]);
    const frameShape = frameAxes.flatMap(axis => [...selectedAxisShape(axis)]);
    const frameIndexShape = frameAxes.filter(axis => axis.preserve).map(axis => axis.size);
    const selectedCellShape = cellAxes.flatMap(axis => [...selectedAxisShape(axis)]);
    const wholeCell = cellAxes.every((axis, index) => axis.preserve && axis.size === cellShape[index]
        && (axis.shape === undefined || axis.shape.length === 1 && axis.shape[0] === cellShape[index])
        && axis.linear?.offset === 0 && axis.linear.stride === 1);
    const read = (index: number, current = observation): RankValue => {
        const coordinates = coordinatesAt(frameIndexShape, index);
        let axisIndex = 0;
        const original = frameAxes.map(axis => axis.indexAt(axis.preserve ? coordinates[axisIndex++] : 0));
        const cell = cells.read(arrayOffset(cells.frameShape, original), current);
        if (wholeCell || cellAxes.length === 0) return cell;
        if (!isRankArray(cell)) throw new RankError('ranked cell selection expects an array');
        return sliceArray(cell, selectionFromAxes(cell.shape, cellAxes));
    };
    if (frameShape.length === 0) return read(0);
    if (frameShape.some(n => n === 0)) return ownedArray([], selection.shape);
    const selected = registerArrayDependencies(framedArray(frameShape, read, {
        shape: selectedCellShape, ownFiles: () => {},
        mismatch: () => new RankError('selected ranked cells must have one shape', 'DimensionMismatch'),
    }), [source]);
    let outputAxis = 0;
    const outputAxes = axes.map(axis => selectedAxisShape(axis).map(() => outputAxis++));
    const stackedAxes = [...framePositions, ...cellPositions].flatMap(axis => outputAxes[axis]);
    const permutation = stackedAxes.map((_, axis) => stackedAxes.indexOf(axis));
    return permutation.some((axis, position) => axis !== position) ? permutedArray(selected, permutation) : selected;
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
    if (arrayCells(source)) {
        const axes = shape.map((size, axis): SelectedAxis => axis < indices.length
            ? { preserve: false, size: 1, indexAt: () => Number(indices[axis]),
                linear: { offset: Number(indices[axis]), stride: 0 } }
            : { preserve: true, size, indexAt: coordinate => coordinate, linear: { offset: 0, stride: 1 } });
        const selected = producerSelection(source, selectionFromAxes(shape, axes));
        if (selected !== undefined) return selected;
    }
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
    return inheritSemanticArrayType(source, selectionArray(rest, source, index => offset + index, { offset, stride: 1 }));
}

/** A leading-axis reverse inside selected cells is one regular tensor slice. */
export function reverseArrayAxis(source: RankArray, selected: number): RankValue {
    const axes = source.shape.map((size, axis): SelectedAxis => {
        const offset = axis === selected ? Math.max(0, size - 1) : 0;
        const stride = axis === selected ? -1 : 1;
        return { preserve: true, size, unique: true, linear: { offset, stride },
            indexAt: coordinate => offset + coordinate * stride };
    });
    return sliceArray(source, selectionFromAxes(source.shape, axes));
}

/** The cells a selection addresses: an array, or the one cell of an empty shape. */
export function sliceArray(
    source: RankArray, selection: TensorSelection, observation?: ArrayCellRead,
): RankValue {
    if (selection.shape.length === 0) {
        if (selection.axes?.some(axis => axis.shape?.length === 0)) {
            return inheritSemanticArrayType(source, selectionArray([], source, selection.offsetAt, selection.linear));
        }
        return arrayItem(source, selection.offsetAt(0));
    }
    const produced = producerSelection(source, selection, observation);
    if (produced !== undefined) return produced;
    const columnAxis = source.columnNames && source.shape.length === 2 ? selection.axes?.[1] : undefined;
    if (columnAxis?.preserve && selection.axes?.[0].preserve === false) {
        return positionalValue(Array.from({ length: columnAxis.size }, (_, column) => arrayItem(source, selection.offsetAt(column))));
    }
    const columnNames = columnAxis?.preserve && selection.shape.length === 2
        ? Array.from({ length: columnAxis.size }, (_, column) => source.columnNames![columnAxis.indexAt(column)]) : undefined;
    const stored = denseScalarItems(source);
    const total = arraySize(selection.shape);
    // Regular slices keep a stored-view plan; material selections copy only
    // on write. Irregular gathers retain the eager threshold and fallback.
    const kind = typedElementKind(source);
    const regular = selection.linear || selection.axes?.every(axis => axis.linear);
    const material = stored && (kind !== undefined || total >= DENSE_SLICE_CELLS);
    if (!regular && material) {
        const compact = integer32Cells(source);
        const reals = kind === 'real' || (kind === undefined && realCells(source) !== undefined);
        const out: RankValue[] | Float64Array | BigInt64Array | Int32Array = compact ? new Int32Array(total) : reals ? new Float64Array(total)
            : kind === 'integer' ? new BigInt64Array(total) : new Array(total);
        gather(compact ?? stored, out as unknown as RankValue[], selection, total);
        const result = Array.isArray(out) ? ownedArray(out, selection.shape, true, columnNames) : typedArray(out, selection.shape, columnNames);
        return source.columnNames ? result : inheritSemanticArrayType(source, result);
    }
    const result = selectionArray(selection.shape, source, selection.offsetAt, selection.linear, !!regular, contiguousSelectionBlock(selection));
    if (material) deferSelectionCopy(result);
    if (columnNames) Object.defineProperty(result, 'columnNames', { value: columnNames });
    return source.columnNames ? result : inheritSemanticArrayType(source, result);
}

/** The largest trailing run with adjacent source cells. Row windows copy one
 * block per row, while full trailing axes collapse into a single larger run. */
function contiguousSelectionBlock(selection: TensorSelection): number {
    const { axes, sourceShape } = selection;
    if (!axes || !sourceShape) return 1;
    let run = 1, stride = 1;
    for (let axis = axes.length - 1; axis >= 0; axis--) {
        const selected = axes[axis];
        if (selected.preserve && selected.size > 1) {
            if (selected.linear?.stride !== 1 || stride !== run) break;
            run *= selected.size;
        }
        stride *= sourceShape[axis];
    }
    return run;
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
    axis = resolveAxis(axis, isRankArray(source) ? source.shape.length : 1);
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
    if (isRankArray(selector) && selector.shape.length !== 1) {
        throw new RankError('axis selector must have rank 1');
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
    if (boolean && isRankArray(selector) && selector.shape.length !== 1) {
        throw new RankError('axis selector must have rank 1');
    }
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
    if (isRankArray(value)) {
        if (value.shape.includes(0) && semanticArrayType(value).scalar === 'boolean') return false;
        const typed = typedElementKind(value);
        if (typed) return typed === 'integer' || value.shape.includes(0);
        const kinds = storedScalarKinds(value);
        // Packed masks keep their existing selection dispatch and diagnostics.
        if (kinds) return kinds.every(kind => kind === 'integer');
    }
    const stored = isRankArray(value) ? denseScalarItems(value) : undefined;
    return stored ? Array.prototype.every.call(stored, (item: RankValue) => typeof item === 'bigint')
        : value.items.every(item => typeof item === 'bigint');
}

