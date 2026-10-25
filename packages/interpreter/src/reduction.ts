import { framedArray } from './framed-array.js';
import { countPackedBooleanRange } from './packed-booleans.js';
import { elementSource } from './element-source.js';
import { arrayCells, arrayValues, arrayValueTraversal, denseScalarItems, derivedArray, eagerOperandItems, integer32Cells, registerArrayDependencies, ownedArray, readArrayItem, shouldStream, typedArray } from './array-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { isPureLazyFunction, snapshotLazyFunction } from './lazy-function.js';
import { standardModules } from './modules/index.js';
import type { RuntimeModule } from './modules/types.js';
import { sumIndexed } from './modules/numbers.js';
import { statisticsCell } from './modules/stats.js';
import { checkpoint, inspectionEnabled, privateLoopPolling } from './interrupt.js';
import { numericKernel } from './numeric-kernels.js';
import { hasNativeImplementation } from './native-implementation.js';
import { dyadicCells, tensorCells } from './rank-application.js';
import { reduceWindowCell, scanSequence } from './sequence.js';
import { reduceTensorMap } from './tensor-map.js';
import { isNativeFunction, isRankArray, isRankSequence, valueRank,
    type NativeFunction, type RankArray, type RankValue } from './value.js';

const arrayItem = readArrayItem;
const MAX_OFFSET_TABLE = 1 << 20;
const arraySize = (shape: readonly number[]): number =>
    shape.reduce((product, dimension) => product * dimension, 1);
const array = (items: RankValue[]): RankArray => ownedArray(items);

/** Numeric and axis reductions share validation, cell traversal and lazy frame assembly. */
export class ReductionEvaluator {
    constructor(
        private readonly binary: (operator: string, left: RankValue, right: RankValue) => RankValue,
        private readonly resolve: (name: string) => RankValue,
        private readonly standardFunctions: ReadonlyMap<RuntimeModule[string], NativeFunction>,
        private readonly tensorFusion: boolean | (() => boolean),
        private readonly scalarCallback: (fn: NativeFunction) => ((arguments_: RankValue[]) => RankValue) | undefined,
        private readonly invoke: (fn: NativeFunction, arguments_: RankValue[]) => RankValue,
        private readonly ownFiles: (value: RankValue) => void,
    ) {}

    private isTensorFusion(): boolean {
        return typeof this.tensorFusion === 'function' ? this.tensorFusion() : this.tensorFusion;
    }

    evaluateReduction(
        operator: string,
        value: RankValue,
        cellRank?: number,
        seed?: RankValue,
        axes?: readonly number[],
    ): RankValue {
        if (cellRank !== undefined && cellRank > 0 || axes && seed !== undefined && isRankArray(seed)) {
            return this.reduceInputCells(value, cellRank ?? 0, axes, seed,
                (left, right) => this.binary(operator, left, right), () => {
                    const identity = reductionIdentity(operator);
                    const shape = isRankArray(value) && cellRank ? value.shape.slice(-cellRank) : [];
                    return ownedArray(Array(arraySize(shape)).fill(identity), shape);
                });
        }
        if (operator === '+' && axes?.length === 1 && isRankArray(value)) {
            const packed = sumIntegerAxis(value, axes[0], seed);
            if (packed !== undefined) return packed;
        }
        // Scalar folds over trailing axes retain the contiguous/window kernels.
        if (axes && isRankArray(value) && new Set(axes).size === axes.length
            && axes.every(axis => axis >= value.shape.length - axes.length && axis < value.shape.length)) {
            if (axes.length === value.shape.length) return this.reduceCell(operator, value, seed);
            const reducedRank = axes.length;
            const frameShape = value.shape.slice(0, value.shape.length - reducedRank);
            const size = arraySize(value.shape.slice(-reducedRank));
            const producer = arrayCells(value) ? dyadicCells(value, reducedRank, true) : undefined;
            return derivedArray(frameShape, seed === undefined ? [value] : [value, seed], index => producer
                ? this.reduceCell(operator, producer.cellAt(index), seed)
                : this.reduceArrayCell(operator, value, index * size, size, seed), true);
        }
        if (axes) return this.reduceAxes(value, axes, cell => this.reduceCell(operator, cell, seed),
            seed === undefined ? [] : [seed]);
        return this.reduceCell(operator, value, seed);
    }

    evaluateScan(operator: string, value: RankValue, seed?: RankValue, axis?: number, rank?: number): RankValue {
        axis = this.scanAxisNumber(value, axis, rank);
        if (axis !== undefined) return this.evaluateScanAxis(operator, value, axis, seed);
        return this.scanValues(value, operator, seed,
            numericKernel(operator, (a, b) => this.binary(operator, a, b)));
    }

    /** Prefix accumulation along one axis; a seed grows that axis by one. */
    evaluateScanAxis(operator: string, value: RankValue, axis: number, seed?: RankValue): RankValue {
        return this.scanAxis(operator, value, axis, numericKernel(operator, (a, b) => this.binary(operator, a, b)), seed, operator);
    }

    /** `scanAxis` with a named binary operation; `max` and `min` run as real loops. */
    evaluateNamedScanAxis(operation: NativeFunction, value: RankValue, axis: number, seed?: RankValue): RankValue {
        const extreme = operation === this.standardFunctions.get(standardModules.core.max) ? 'max'
            : operation === this.standardFunctions.get(standardModules.core.min) ? 'min' : undefined;
        const scalar = this.scalarCallback(operation);
        return this.scanAxis(operation.name, value, axis, (left, right) => {
            const arguments_ = [left, right];
            return scalar ? scalar(arguments_) : operation.call(arguments_);
        }, seed, hasNativeImplementation(operation) ? extreme : undefined);
    }

    evaluateNamedScan(operation: NativeFunction, value: RankValue, seed?: RankValue, axis?: number, rank?: number): RankValue {
        axis = this.scanAxisNumber(value, axis, rank);
        if (axis !== undefined) return this.evaluateNamedScanAxis(operation, value, axis, seed);
        if (isRankSequence(value)) operation = snapshotLazyFunction(operation);
        const scalar = this.scalarCallback(operation);
        return this.scanValues(value, operation.name, seed, (left, right) => {
            const arguments_ = [left, right];
            return scalar ? scalar(arguments_) : operation.call(arguments_);
        }, isPureLazyFunction(operation), [new Map([['callback', operation]])]);
    }

    evaluateNamedReduction(operation: NativeFunction, value: RankValue, seed?: RankValue,
        rank?: number, axes?: readonly number[]): RankValue {
        if (rank !== undefined && rank > 0 || axes !== undefined) {
            const scalar = this.scalarCallback(operation);
            return this.reduceInputCells(value, rank ?? 0, axes, seed,
                (left, right) => scalar && !isRankArray(left) && !isRankArray(right)
                    ? scalar([left, right]) : this.invoke(operation, [left, right]), () => {
                    throw new RankError(`reduce ${operation.name} requires an initial value for an empty collection`);
                }, [operation]);
        }
        const scalar = this.scalarCallback(operation);
        const values = reductionValues(value, operation.name);
        let result = seed;
        for (const item of values) {
            if (result === undefined) result = item;
            else result = scalar ? scalar([result, item]) : operation.call([result, item]);
        }
        if (result === undefined) {
            throw new RankError(`reduce ${operation.name} requires an initial value for an empty collection`);
        }
        return result;
    }

    /** Fold trailing input cells; axes outside those cells form traversal or independent frames. */
    private reduceInputCells(value: RankValue, rank: number, axes: readonly number[] | undefined,
        seed: RankValue | undefined, combine: (left: RankValue, right: RankValue) => RankValue,
        empty: () => RankValue, captures: readonly RankValue[] = []): RankValue {
        if (!isRankArray(value)) throw new RankError('reduce with input cell rank or axis expects an array');
        const boundary = value.shape.length - rank;
        if (boundary < 0) throw new RankError(`rank ${rank} exceeds tensor rank ${value.shape.length}`);
        const traversal = axes ?? Array.from({ length: boundary }, (_, i) => i);
        if (new Set(traversal).size !== traversal.length) throw new RankError('reduce axes must be unique');
        if (traversal.some(axis => axis < 0 || axis >= boundary)) {
            throw new RankError('reduce axis must be outside the trailing input cell');
        }
        const frameAxes = Array.from({ length: boundary }, (_, i) => i).filter(axis => !traversal.includes(axis));
        const frames = tensorCells(value, frameAxes);
        const fold = (index: number): RankValue => {
            const region = frames.cellAt(index);
            if (!isRankArray(region)) throw new RankError('reduce cell region must be an array');
            const cells = dyadicCells(region, rank);
            let accumulator = seed;
            for (let i = 0; i < arraySize(cells.frameShape); i++) {
                checkpoint('reducing input cells');
                const cell = cells.cellAt(i);
                accumulator = accumulator === undefined ? cell : combine(accumulator, cell);
            }
            return accumulator === undefined ? empty() : accumulator;
        };
        if (!frameAxes.length) return fold(0);
        if (arraySize(frames.frameShape) === 0) {
            const resultShape = seed === undefined ? rank === 0 ? [] : value.shape.slice(-rank) : isRankArray(seed) ? seed.shape : [];
            return ownedArray([], [...frames.frameShape, ...resultShape]);
        }
        return registerArrayDependencies(framedArray(frames.frameShape, fold, {
            ownFiles: this.ownFiles,
            mismatch: () => new RankError('reduce results must have matching shapes', 'DimensionMismatch'),
        }), [value, ...captures, ...(seed === undefined ? [] : [seed])]);
    }

    /** Select scalar lines; rank R scans the leading axis of each trailing rank-R cell. */
    private scanAxisNumber(value: RankValue, axis?: number, rank?: number): number | undefined {
        if (rank === undefined) return axis;
        if (rank === 0 || rank > valueRank(value)) throw new RankError('scan rank must be between 1 and the source rank');
        return isRankArray(value) ? value.shape.length - rank : undefined;
    }

    private reduceAxes(value: RankValue, axes: readonly number[], reduce: (cell: RankValue) => RankValue,
        captures: readonly RankValue[] = []): RankValue {
        if (!isRankArray(value)) throw new RankError('reduce axis expects an array');
        if (new Set(axes).size !== axes.length) throw new RankError('reduce axes must be unique');
        for (const axis of axes) if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
        const frameAxes = value.shape.map((_, i) => i).filter(i => !axes.includes(i));
        const contiguous = frameAxes.every((axis, index) => axis === index);
        const cells = contiguous ? dyadicCells(value, value.shape.length - frameAxes.length) : tensorCells(value, frameAxes);
        if (!cells.frameShape.length) return reduce(cells.cellAt(0));
        return derivedArray(cells.frameShape, [value, ...captures], index => reduce(cells.cellAt(index)));
    }

    private scanAxis(operator: string, value: RankValue, axis: number,
        operation: (left: RankValue, right: RankValue) => RankValue, seed?: RankValue, nativeOperator?: string): RankValue {
        if (!isRankArray(value)) throw new RankError(`scan ${operator} axis expects an array`);
        if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
        const shape = value.shape;
        const size = arraySize(shape);
        const length = shape[axis];
        const inner = arraySize(shape.slice(axis + 1));
        const outer = arraySize(shape.slice(0, axis));
        if (seed !== undefined) {
            if (valueRank(seed) !== 0) throw new RankError('scan axis seed must be a scalar');
            const outShape = [...shape];
            outShape[axis]++;
            const out: RankValue[] = new Array(arraySize(outShape));
            for (let block = 0; block < outer; block++) {
                const start = block * (length + 1) * inner;
                for (let lane = 0; lane < inner; lane++) out[start + lane] = seed;
                for (let step = 0; step < length; step++) {
                    const at = start + (step + 1) * inner;
                    const source = (block * length + step) * inner;
                    for (let lane = 0; lane < inner; lane++) {
                        const accumulated = operation(out[at - inner + lane], arrayItem(value, source + lane));
                        if (valueRank(accumulated) !== 0) throw new RankError('scan axis operation must return a scalar');
                        out[at + lane] = accumulated;
                    }
                }
            }
            return ownedArray(out, outShape);
        }
        const cells = eagerOperandItems(value)
            ?? Array.from({ length: size }, (_, index) => arrayItem(value, index));
        const reals = realView(cells);
        if (reals && nativeOperator && ['+', '-', '*', 'max', 'min'].includes(nativeOperator)) {
            const out = new Float64Array(size);
            for (let start = 0; start < size; start += length * inner) {
                for (let index = 0; index < inner && length > 0; index += 1) out[start + index] = reals[start + index];
                for (let step = 1; step < length; step += 1) {
                    const at = start + step * inner;
                    if (nativeOperator === '+') for (let index = at; index < at + inner; index += 1) out[index] = out[index - inner] + reals[index];
                    else if (nativeOperator === 'max') for (let index = at; index < at + inner; index += 1) out[index] = Math.max(out[index - inner], reals[index]);
                    else if (nativeOperator === 'min') for (let index = at; index < at + inner; index += 1) out[index] = Math.min(out[index - inner], reals[index]);
                    else if (nativeOperator === '-') for (let index = at; index < at + inner; index += 1) out[index] = out[index - inner] - reals[index];
                    else for (let index = at; index < at + inner; index += 1) out[index] = out[index - inner] * reals[index];
                }
            }
            return typedArray(out, shape);
        }
        const out: RankValue[] = new Array(size);
        for (let block = 0; block < outer; block += 1) {
            const start = block * length * inner;
            for (let step = 0; step < length; step += 1) {
                const at = start + step * inner;
                for (let index = at; index < at + inner; index += 1) {
                    out[index] = step === 0 ? cells[index] : operation(out[index - inner], cells[index]);
                }
            }
        }
        return ownedArray(out, shape);
    }

    scanValues(value: RankValue, operator: string, seed: RankValue | undefined,
        operation: (left: RankValue, right: RankValue) => RankValue, pure = true,
        captures?: readonly ReadonlyMap<string, RankValue>[]): RankValue {
        if (valueRank(value) !== 1) {
            throw new RankError(`scan ${operator} expects a rank-1 value`);
        }
        if (isRankSequence(value)) {
            return scanSequence(value, operator, seed, operation, pure, captures);
        }
        const result: RankValue[] = [];
        if (seed !== undefined) result.push(seed);
        if (isRankArray(value)) {
            const size = arraySize(value.shape);
            if (size === 0) return array(result);
            let accumulated = seed === undefined
                ? arrayItem(value, 0)
                : operation(seed, arrayItem(value, 0));
            result.push(accumulated);
            for (let index = 1; index < size; index += 1) {
                accumulated = operation(accumulated, arrayItem(value, index));
                result.push(accumulated);
            }
            return array(result);
        }
        let accumulated: RankValue | undefined = seed;
        for (const item of reductionValues(value, operator)) {
            accumulated = accumulated === undefined
                ? item
                : operation(accumulated, item);
            result.push(accumulated);
        }
        return ownedArray(result);
    }

    evaluateAxisReduction(
        operation: string,
        value: RankValue,
        axes: readonly number[],
    ): RankValue {
        if (!isRankArray(value)) throw new RankError(`${operation} axis expects an array`);
        for (const axis of axes) {
            if (axis >= value.shape.length) throw new RankError(`array has no axis ${axis}`);
        }
        if (new Set(axes).size !== axes.length) {
            throw new RankError(`${operation} axes must be unique`);
        }

        const selected = new Set(axes);
        const reducedAxes = value.shape.map((_, axis) => axis).filter(axis => selected.has(axis));
        const frameAxes = value.shape.map((_, axis) => axis).filter(axis => !selected.has(axis));
        const reducedShape = reducedAxes.map(axis => value.shape[axis]);
        const frameShape = frameAxes.map(axis => value.shape[axis]);
        const reducer = this.resolve(operation);
        if (!isNativeFunction(reducer)) throw new RankError(`${operation} is not an operation`);
        const builtin = hasNativeImplementation(reducer) && ['core', 'numbers', 'stats', 'sequences'].some(module => {
            const definition = standardModules[module][operation];
            return definition !== undefined && reducer === this.standardFunctions.get(definition);
        });
        const booleanFold = builtin && (operation === 'any' || operation === 'all');

        const strides = value.shape.map(() => 1);
        for (let axis = strides.length - 2; axis >= 0; axis -= 1) {
            strides[axis] = strides[axis + 1] * value.shape[axis + 1];
        }
        const reducedSize = arraySize(reducedShape);
        const offsetAt = (index: number, axes: readonly number[]): number => {
            let offset = 0;
            for (let current = axes.length - 1; current >= 0; current -= 1) {
                const axis = axes[current];
                offset += (index % value.shape[axis]) * strides[axis];
                index = Math.floor(index / value.shape[axis]);
            }
            return offset;
        };
        // Numeric fallback cells must still be fully read before the reducer validates them.
        // A table too big to collect is the exception: it is summed a cell at a time, nothing held.
        const streaming = shouldStream(value);
        const directSum = builtin && operation === 'sum' && (value.itemAt === undefined || streaming)
            && reducer === this.standardFunctions.get(standardModules.core.sum);

        // Stored cells are read straight from their storage, through offsets
        // worked out once for the reduced axes instead of once per cell.
        const stored = denseScalarItems(value);
        const producer = arrayCells(value) ? tensorCells(value, frameAxes) : undefined;
        // Reuse checked scalar views so native terminals see the original map.
        // Boolean folds consume the same view in reference mode to short-circuit
        // within each cell, just as a whole-array fold does.
        const scalarCells = !producer && reducedAxes.length > 0
            && (booleanFold || builtin && this.isTensorFusion()) ? tensorCells(value, frameAxes) : undefined;
        let reducedOffsets: Int32Array | undefined;
        if (stored && reducedSize <= MAX_OFFSET_TABLE) {
            reducedOffsets = new Int32Array(reducedSize);
            for (let index = 0; index < reducedSize; index += 1) reducedOffsets[index] = offsetAt(index, reducedAxes);
        }
        const packedCount = builtin && operation === 'count' && reducedAxes.length > 0
            && reducedAxes.every((axis, i) => axis === value.shape.length - reducedAxes.length + i);
        const reduceAt = (frameIndex: number): RankValue => {
            if (!producer && packedCount) {
                const packed = countPackedBooleanRange(value, offsetAt(frameIndex, frameAxes), reducedSize);
                if (packed !== undefined) return packed;
            }
            if (producer) return reducer.call([producer.cellAt(frameIndex)]);
            if (scalarCells && hasNativeImplementation(reducer)) {
                const cell = scalarCells.cellAt(frameIndex);
                if (booleanFold) return reducer.call([cell]);
                if (isRankArray(cell)) {
                    const native = reduceTensorMap(cell, operation);
                    if (native !== undefined) return native;
                }
            }
            const start = offsetAt(frameIndex, frameAxes);
            const itemAt = stored && reducedOffsets
                ? (index: number) => stored[start + reducedOffsets![index]]
                : streaming && value.streamAt
                    ? (index: number) => value.streamAt!(start + offsetAt(index, reducedAxes))
                    : (index: number) => arrayItem(value, start + offsetAt(index, reducedAxes));
            if (directSum && hasNativeImplementation(reducer)) return sumIndexed(reducedSize, itemAt);
            if (builtin && hasNativeImplementation(reducer) && this.isTensorFusion()
                && (operation === 'mean' || operation === 'std')
                && reducer === this.standardFunctions.get(standardModules.stats[operation])) {
                return statisticsCell(operation, reducedSize, itemAt);
            }
            const items: RankValue[] = [];
            for (let index = 0; index < reducedSize; index += 1) {
                try {
                    items.push(itemAt(index));
                } catch (error) {
                    if (!(error instanceof MissingValueError)
                        || (operation !== 'mean' && operation !== 'median' && operation !== 'std')) {
                        throw error;
                    }
                }
            }
            const shape = items.length === reducedSize ? reducedShape : [items.length];
            return reducer.call([{ kind: 'array', items, shape }]);
        };

        if (frameShape.length === 0) return reduceAt(0);
        return derivedArray(frameShape, [value, reducer], reduceAt, builtin);
    }

    private reduceCell(operator: string, value: RankValue, seed?: RankValue): RankValue {
        if (isRankArray(value)) return this.reduceArrayCell(operator, value, 0, arraySize(value.shape), seed);
        if (seed === undefined) {
            const planned = elementSource(value, operator, 'reduce')?.reduce?.(operator);
            if (planned !== undefined) return planned;
        }
        const values = reductionValues(value, operator);
        const first = values.next();
        if (first.done) return seed === undefined ? reductionIdentity(operator) : seed;
        const operation = numericKernel(operator, (a, b) => this.binary(operator, a, b));
        let result = seed === undefined ? first.value : operation(seed, first.value);
        for (let next = values.next(); !next.done; next = values.next()) {
            result = operation(result, next.value);
        }
        return result;
    }

    private reduceArrayCell(
        operator: string,
        value: RankArray,
        start: number,
        size: number,
        seed?: RankValue,
    ): RankValue {
        const operation = numericKernel(operator, (a, b) => this.binary(operator, a, b));
        if (size > 0 && seed === undefined && this.isTensorFusion()) {
            const folded = reduceWindowCell(value, start, size, operation);
            if (folded !== undefined) return folded;
        }
        if (start === 0 && size === arraySize(value.shape) && (arrayValueTraversal(value) || arrayCells(value))) {
            let result = seed;
            for (const item of arrayValues(value)) result = result === undefined ? item : operation(result, item);
            return result === undefined ? reductionIdentity(operator) : result;
        }
        if (size === 0) return seed === undefined ? reductionIdentity(operator) : seed;
        let result = seed === undefined
            ? arrayItem(value, start)
            : operation(seed, arrayItem(value, start));
        const end = start + size;
        for (let index = start + 1; index < end; index += 1) {
            result = operation(result, arrayItem(value, index));
        }
        return result;
    }

}

/** The cells as reals when every one is a real number. */
function realView(cells: ArrayLike<RankValue>): ArrayLike<number> | undefined {
    if (cells instanceof Float64Array) return cells;
    for (let index = 0; index < cells.length; index += 1) {
        if (typeof cells[index] !== 'number') return undefined;
    }
    return cells as ArrayLike<number>;
}

export function* reductionValues(value: RankValue, operation: string): IterableIterator<RankValue> {
    const source = elementSource(value, `reduce ${operation}`, 'reduce');
    yield* source ? source.values() : [value];
}

function reductionIdentity(operator: string): RankValue {
    if (operator === '+') return 0n;
    if (operator === '*') return 1n;
    if (operator === 'and') return true;
    if (operator === 'or' || operator === 'xor') return false;
    throw new RankError(`reduce ${operator} does not define a value for an empty cell`);
}

/** A dense Int32 fold can accumulate exact integers in doubles: even the
 * largest absolute partial sum is bounded by length * 2^31. The seed stays
 * BigInt and is added afterwards, so it never weakens that proof. */
function sumIntegerAxis(value: RankArray, axis: number, seed?: RankValue): RankValue | undefined {
    if (inspectionEnabled() || !privateLoopPolling() || value.itemAt !== undefined
        || seed !== undefined && typeof seed !== 'bigint') return undefined;
    const cells = integer32Cells(value);
    if (!cells || axis < 0 || axis >= value.shape.length) return undefined;
    const length = value.shape[axis];
    if (length > Math.floor(Number.MAX_SAFE_INTEGER / 2147483648)) return undefined;
    const inner = arraySize(value.shape.slice(axis + 1));
    const outer = arraySize(value.shape.slice(0, axis));
    const shape = value.shape.filter((_, index) => index !== axis);
    if (inner === 0) return ownedArray([], shape);
    const totals = new Float64Array(outer * inner);
    for (let block = 0; block < outer; block++) {
        const target = block * inner;
        for (let row = 0; row < length; row++) {
            const source = (block * length + row) * inner;
            for (let start = 0; start < inner; start += 65536) {
                const end = Math.min(inner, start + 65536);
                checkpoint('summing integer axis', end - start);
                for (let lane = start; lane < end; lane++) totals[target + lane] += cells[source + lane];
            }
        }
    }
    const items: RankValue[] = new Array(totals.length);
    for (let index = 0; index < totals.length; index++) {
        if ((index & 4095) === 0) checkpoint('completing integer axis sum');
        items[index] = BigInt(totals[index]) + ((seed as bigint | undefined) ?? 0n);
    }
    return shape.length ? ownedArray(items, shape) : items[0];
}
