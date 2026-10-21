import { demandValue } from './plan.js';
import { scalarBuiltinArray } from './scalar-builtin.js';
import { mapStoredIntegers } from './integer-array-kernel.js';
import { rankedCells } from './ranked-cells.js';
import { framedArray } from './framed-array.js';
import { ALL_AXIS, atArray, sliceArray, tensorSelection } from './selectors.js';
import { rankedNumericFind } from './numeric-search.js';
import { arrayCells, arrayFrameAxes, arrayValues, derivedArray, ownedArray, readArrayItem, registerArrayDependencies, registerArrayReadPlan, typedArray } from './array-storage.js';
import { prepareStoredScalarView, registerScalarView } from './integer-view.js';
import type { RankedMembership } from './membership-function.js';
import { completed, type Evaluation } from './execution.js';
import { MissingValueError, RankError } from './errors.js';
import { isPureLazyFunction, snapshotLazyFunction } from './lazy-function.js';
import { checkpoint, checkInterrupt, InterruptedError, privateLoopPolling } from './interrupt.js';
import { hasNativeImplementation } from './native-implementation.js';
import { standardModules } from './modules/index.js';
import type { RuntimeModule } from './modules/types.js';
import { textFunctionSqlite } from './modules/sqlite.js';
import { arraySequenceOperands, mapSequence } from './sequence.js';
import { broadcastShape, mapBroadcastArrays } from './tensor.js';
import { arrayOffset, coordinatesAt, sameShape } from './tensor-index.js';
import { isRankArray, isRankLabel, isRankSqliteExpression, isRankSequence, valueRank,
    type IntrinsicRank, type NativeFunction, type RankArray, type RankValue } from './value.js';

const arrayItem = readArrayItem;
const DENSE_FRAME_CELLS = 1024;
const arraySize = (shape: readonly number[]): number =>
    shape.reduce((product, dimension) => product * dimension, 1);
/** Apply an operation to ranked cells and assemble its lazy framed result. */
export class RankApplication {
    constructor(
        private readonly invoke: (fn: NativeFunction, args: RankValue[]) => Evaluation<RankValue>,
        private readonly ownFiles: (value: RankValue) => void,
        private readonly standardFunctions: ReadonlyMap<RuntimeModule[string], NativeFunction>,
        private readonly scalarCallback: (fn: NativeFunction) => ((arguments_: RankValue[]) => RankValue) | undefined,
        private readonly arrayBatch?: (fn: NativeFunction, source: RankArray, axes: readonly number[]) =>
            (RankedMembership & { available(): boolean }) | undefined,
    ) {}

    applyUnaryAtRank(
        value: RankValue,
        fn: Extract<RankValue, { kind: 'function' }>,
        cellRank: number,
        frameAxes?: readonly number[],
    ): Evaluation<RankValue> {
        if (fn.name === 'text' && isRankSqliteExpression(value)) {
            return completed(textFunctionSqlite(
                value.boolean ? 'rank_boolean_text' : 'rank_text', [value]));
        }
        if (frameAxes !== undefined && !isRankArray(value)) {
            throw new RankError('axis rank expects an array');
        }
        if (cellRank < 0) {
            // Text and sequences have one axis of elements.
            cellRank = resolveCellRank(cellRank, isRankArray(value) ? value.shape.length
                : typeof value === 'string' || isRankSequence(value) ? 1 : 0);
        }
        if (typeof value === 'string') {
            if (cellRank >= 1) return this.invoke(fn, [value]);
            const cells = textCells(value);
            // Text cells are immutable inputs; each ranked demand still recomputes.
            return completed(this.applyToTensorCells(derivedArray(cells.frameShape, [], cells.cellAt, true), fn, [0]));
        }
        if (isRankSequence(value)) {
            if (cellRank >= 1) return this.invoke(fn, [value]);
            fn = snapshotLazyFunction(fn);
            const scalar = this.scalarCallback(fn);
            return completed(mapSequence(value, fn.name, atom => demandValue(scalar ? scalar([atom]) : fn.call([atom])), isPureLazyFunction(fn),
                [new Map<string, RankValue>([['source', value], ['callback', fn]])]));
        }
        if (isRankArray(value)) {
            if (frameAxes === undefined && cellRank >= value.shape.length) return this.invoke(fn, [value]);
            const axes = tensorFrameAxes(value.shape, frameAxes, cellRank);
            if (axes.length === 0) return this.invoke(fn, [value]);
            return completed(this.applyToTensorCells(value, fn, axes));
        }
        return this.invoke(fn, [value]);
    }

    applyIntrinsicRank(
        fn: NativeFunction,
        arguments_: RankValue[],
    ): Evaluation<RankValue> {
        if (fn.name === 'text' && arguments_.length === 1
            && isRankSqliteExpression(arguments_[0])) {
            return completed(textFunctionSqlite(
                arguments_[0].boolean ? 'rank_boolean_text' : 'rank_text', arguments_));
        }
        if (arguments_.length === 1 && fn.monadicRank !== 'all') {
            return this.applyUnaryAtRank(
                arguments_[0], fn, fn.monadicRank,
            );
        }
        if (arguments_.length === 2 && fn.dyadicRanks
            && !isRankLabel(arguments_[1])
            && arguments_.some(isRankArray)) {
            return this.applyDyadicAtRank(
                arguments_[0], arguments_[1], fn,
            );
        }
        return this.invoke(fn, arguments_);
    }

    applyDyadicAtRank(
        left: RankValue,
        right: RankValue,
        fn: NativeFunction,
        customLeftRank?: number,
        customRightRank?: number,
    ): Evaluation<RankValue> {
        const [defaultLeftRank, defaultRightRank] = fn.dyadicRanks ?? ['all', 'all'];
        const leftRank = customLeftRank ?? defaultLeftRank;
        const rightRank = customRightRank ?? defaultRightRank;
        // Only an elementwise sequence operand participates in array broadcasting.
        // Whole-sequence arguments (rank 1/all) retain their function contract.
        if ((isRankSequence(left) && resolveCellRank(leftRank, 1) === 0)
            || (isRankSequence(right) && resolveCellRank(rightRank, 1) === 0)) {
            [left, right] = arraySequenceOperands(left, right);
        }
        const a = dyadicCells(left, leftRank, customLeftRank !== undefined);
        const b = dyadicCells(right, rightRank, customRightRank !== undefined);
        const frameShape = broadcastShape(
            a.frameShape, b.frameShape,
        );
        if (frameShape.length === 0) {
            return this.invoke(fn, [left, right]);
        }
        const stackResults = fn.arrayCells || (customLeftRank !== undefined && !fn.dyadicRanks);
        if (arraySize(frameShape) === 0) {
            fn = fn.snapshot?.() ?? fn;
            return completed(stackResults ? this.stackedCells(left, right, a, b, frameShape, fn)
                : emptyFrameArray(frameShape, frameShape.length, [
                    { value: left, axes: a.frameShape.map((_, axis) => axis) },
                    { value: right, axes: b.frameShape.map((_, axis) => axis) },
                ]));
        }
        if (leftRank === 0 && rightRank === 0
            && fn === this.standardFunctions.get(standardModules.numbers.gcd)) {
            const integers = mapStoredIntegers(left, right, 'gcd');
            if (integers) return completed(integers);
        }
        // The standard find holds the complete left vector and maps scalar
        // targets. Keep error demand lazy and share one revision-checked index.
        if (customLeftRank === undefined && customRightRank === undefined
            && fn === this.standardFunctions.get(standardModules.sequences.find)
            && a.frameShape.length === 0 && rightRank === 0) {
            const search = rankedNumericFind(left);
            const sources = [left, right, fn];
            return completed(derivedArray(frameShape, sources, index => {
                const target = b.cellAt(index);
                return search(target) ?? fn.call([left, target]);
            }, true));
        }
        fn = fn.snapshot?.() ?? fn;
        // A cell that returns an array, or an explicit rank on a function without its own
        // dyadic ranks, stacks its results under the frame.
        if (stackResults) {
            return completed(this.stackedCells(left, right, a, b, frameShape, fn));
        }
        const scalar = this.scalarCallback(fn);
        const applyCell = (x: RankValue, y: RankValue): RankValue => {
            const arguments_ = [x, y];
            const result = demandValue(scalar ? scalar(arguments_) : fn.call(arguments_));
            // Text is a boxed cell, as in unary ranked application.
            if (valueRank(result) !== 0 && typeof result !== 'string') {
                throw new RankError(
                    `rank operation ${fn.name} must return a scalar`,
                );
            }
            this.ownFiles(result);
            return result;
        };
        // Only completed scalar storage permits speculative bulk evaluation.
        // Reading a plan here would move effects and failures before demand.
        // A domain failure on stored data leaves the ordinary lazy form.
        const frameSize = arraySize(frameShape);
        if (frameSize >= DENSE_FRAME_CELLS && leftRank === 0 && rightRank === 0
            && (a.frameShape.length === 0 || b.frameShape.length === 0 || sameShape(a.frameShape, b.frameShape))
            && privateLoopPolling() && this.isPureBuiltin(fn)
            && storedScalarOperand(left) && storedScalarOperand(right)) {
            checkInterrupt('computing array');
            const cells: RankValue[] = new Array(frameSize);
            // Real results (max, min over reals) go into one typed buffer.
            let reals: Float64Array | undefined = new Float64Array(frameSize);
            try {
                for (let index = 0; index < frameSize; index += 1) {
                    if ((index & 0xfff) === 0) checkpoint('computing array', Math.min(4096, frameSize - index));
                    const result = applyCell(
                        a.cellAt(a.frameShape.length === 0 ? 0 : index),
                        b.cellAt(b.frameShape.length === 0 ? 0 : index));
                    if (reals) {
                        if (typeof result === 'number') reals[index] = result;
                        else {
                            for (let done = 0; done < index; done += 1) cells[done] = reals[done];
                            reals = undefined;
                        }
                    }
                    if (!reals) cells[index] = result;
                }
                return completed(reals ? typedArray(reals, frameShape) : ownedArray(cells, frameShape));
            } catch (error) {
                if (error instanceof InterruptedError || !(error instanceof RankError)) throw error;
            }
        }
        // Each native read evaluates its operands; ordinary binding retains the result.
        const sources = [left, right, fn];
        if (a.frameShape.length === 0) {
            return completed(derivedArray(frameShape, sources, index =>
                applyCell(a.cellAt(0), b.cellAt(index)), true));
        }
        if (b.frameShape.length === 0) {
            return completed(derivedArray(frameShape, sources, index =>
                applyCell(a.cellAt(index), b.cellAt(0)), true));
        }
        if (sameShape(a.frameShape, b.frameShape)) {
            return completed(derivedArray(frameShape, sources, index =>
                applyCell(a.cellAt(index), b.cellAt(index)), true));
        }
        const leftCells = derivedArray(a.frameShape, [left], a.cellAt);
        const rightCells = derivedArray(b.frameShape, [right], b.cellAt);
        return completed(registerArrayDependencies(mapBroadcastArrays(
            leftCells,
            rightCells,
            applyCell,
        ), [leftCells, rightCells, fn]));
    }

    /**
     * Frame of cells whose results may be arrays. Results must share one shape and
     * stack under the frame (the `stack` rule), else the read raises `DimensionMismatch`.
     * The cell shape comes from the first cell, read when the shape is first needed.
     */
    private stackedCells(
        left: RankValue,
        right: RankValue,
        a: OuterCells,
        b: OuterCells,
        frameShape: readonly number[],
        fn: NativeFunction,
    ): RankArray {
        const frameSize = arraySize(frameShape);
        if (frameSize === 0) {
            const resultShape = fn.dyadicResultShape?.(a.cellShape, b.cellShape)?.map(n => n ?? 0) ?? [];
            return emptyFrameArray([...frameShape, ...resultShape], frameShape.length, [
                { value: left, axes: a.frameShape.map((_, axis) => axis) },
                { value: right, axes: b.frameShape.map((_, axis) => axis) },
            ]);
        }
        const operandIndex = (operandFrame: readonly number[], frameIndex: number): number => {
            if (operandFrame.length === 0) return 0;
            if (sameShape(operandFrame, frameShape)) return frameIndex;
            const coordinates = coordinatesAt(frameShape, frameIndex).slice(frameShape.length - operandFrame.length);
            return arrayOffset(operandFrame, coordinates.map((coordinate, axis) =>
                operandFrame[axis] === 1 ? 0 : coordinate));
        };
        const scalar = this.scalarCallback(fn);
        const result = framedArray(frameShape, frameIndex => {
            const args = [a.cellAt(operandIndex(a.frameShape, frameIndex)),
                b.cellAt(operandIndex(b.frameShape, frameIndex))];
            return scalar ? scalar(args) : fn.call(args);
        }, {
            shape: fn.dyadicResultShape?.(a.cellShape, b.cellShape),
            ownFiles: this.ownFiles,
            mismatch: (before, after) => new RankError(
                `ranked results must have the same shape: ${before.join(' ')} and ${after.join(' ')}`,
                'DimensionMismatch',
            ),
        });
        return registerArrayDependencies(result, [left, right, fn]);
    }

    private applyToTensorCells(
        value: RankArray,
        fn: Extract<RankValue, { kind: 'function' }>,
        frameAxes: readonly number[],
    ): RankValue {
        fn = fn.snapshot?.() ?? fn;
        const cells = tensorCells(value, frameAxes);
        const frameSize = arraySize(cells.frameShape);
        if (frameSize === 0) {
            const resultShape = this.emptyFrameCellShape(fn, cells.cellShape) ?? [];
            return emptyFrameArray([...cells.frameShape, ...resultShape], cells.frameShape.length,
                [{ value, axes: frameAxes }]);
        }
        if (frameAxes.length === 0) return fn.call([cells.cellAt(0)]);

        if (fn === this.standardFunctions.get(standardModules.numbers.abs)
            && frameAxes.length === value.shape.length
            && frameAxes.every((axis, index) => axis === index)) {
            const integers = mapStoredIntegers(value, 0n, 'abs');
            if (integers) return integers;
        }
        const scalarBuiltin = scalarBuiltinArray(value, fn, frameAxes);
        if (scalarBuiltin) return scalarBuiltin;

        return rankedCells(value, fn, cells,
            cells.cellShape.length === 0 ? this.scalarCallback(fn) : undefined,
            this.ownFiles, () => this.arrayBatch?.(fn, value, frameAxes));
    }

    private isPureBuiltin(fn: Extract<RankValue, { kind: 'function' }>): boolean {
        return hasNativeImplementation(fn) && ['core', 'numbers', 'linalg', 'stats', 'sequences', 'text'].some(module =>
            Object.values(standardModules[module]).some(definition => this.standardFunctions.get(definition) === fn));
    }

    /**
     * An empty frame has no cell to call, yet its result keeps the cell axes:
     * `0 3` rows sorted are still `0 3`. A declared contract wins, even if
     * its result rank is unknown. A pure builtin without a shape hook runs
     * once on a zero fill cell, as in J; only the result shape is kept.
     * Unknown shapes return `undefined`.
     */
    private emptyFrameCellShape(
        fn: Extract<RankValue, { kind: 'function' }>,
        cellShape: readonly number[],
    ): readonly number[] | undefined {
        const declared = fn.monadicResultShape?.(cellShape);
        if (fn.monadicResultShape || !this.isPureBuiltin(fn)) return declared?.map(n => n ?? 0);
        const size = arraySize(cellShape);
        if (size > FILL_CELL_LIMIT) return undefined;
        const fill = cellShape.length === 0 ? 0n
            : ownedArray(Array.from({ length: size }, () => 0n), cellShape, true);
        try {
            const result = fn.call([fill]);
            return isRankArray(result) ? [...result.shape] : [];
        } catch (error) {
            if (error instanceof RankError && !(error instanceof InterruptedError)) return undefined;
            throw error;
        }
    }

}

/** Larger fill cells cost more than an unknown result cell shape is worth. */
const FILL_CELL_LIMIT = 1 << 16;

/** No new operation cell exists, but an operand can still contain nonempty
 * producer frames of empty cells. Preserve their selected observations. Axes
 * consumed by the new operation belong to one result cell, not a result frame.
 * Frame axes right-align for broadcasting unless an explicit offset places
 * them in concatenated outer frames. */
export function emptyFrameArray(shape: readonly number[], frameRank: number,
    operands: readonly { value: RankValue; axes: readonly number[]; offset?: number }[]): RankArray {
    const inputs = operands.flatMap(({ value, axes, offset }) => {
        if (!isRankArray(value)) return [];
        const cells = arrayCells(value);
        if (!cells) return [];
        const sourceFrames = arrayFrameAxes(cells);
        const cellShape = cells.cellShape() ?? value.shape.filter((_, axis) => !sourceFrames.includes(axis));
        return arraySize(cellShape) === 0 ? [{ value, axes, cells, leading: offset ?? frameRank - axes.length }] : [];
    });
    if (!inputs.length) return ownedArray([], shape);
    const frames = new Set<number>();
    for (const input of inputs) for (const axis of arrayFrameAxes(input.cells)) {
        const position = input.axes.indexOf(axis);
        if (position >= 0) frames.add(input.leading + position);
    }
    const frameAxes = [...frames].sort((a, b) => a - b);
    const frameShape = frameAxes.map(axis => shape[axis]);
    if (frameShape.some(size => size === 0)) return ownedArray([], shape);
    const cellShape = shape.filter((_, axis) => !frames.has(axis));
    const result = derivedArray(shape, inputs.map(input => input.value), () => {
        throw new MissingValueError('empty ranked result has no scalar cells');
    }, true);
    return registerArrayReadPlan(result, { cells: {
        frameAxes, frameShape, cellShape: () => cellShape,
        read(index, observation) {
            const coordinates = coordinatesAt(frameShape, index);
            for (const input of inputs) {
                const selectors = input.value.shape.map((size, axis) => {
                    const position = input.axes.indexOf(axis);
                    const frame = position < 0 ? -1 : frameAxes.indexOf(input.leading + position);
                    return frame < 0 ? ALL_AXIS : BigInt(size === 1 ? 0 : coordinates[frame]);
                });
                const selected = sliceArray(input.value, tensorSelection(input.value, selectors), observation?.branch(input));
                if (isRankArray(selected)) for (const _ of arrayValues(selected)) { /* Finish its producers. */ }
            }
            return ownedArray([], cellShape);
        },
    } });
}

export function tensorFrameAxes(
    shape: readonly number[],
    specifiedAxes: readonly number[] | undefined,
    cellRank: number,
): readonly number[] {
    if (cellRank > shape.length) {
        throw new RankError(`rank ${cellRank} exceeds tensor rank ${shape.length}`);
    }
    const frameRank = shape.length - cellRank;
    const axes = specifiedAxes ?? Array.from({ length: frameRank }, (_, index) => index);
    if (axes.length !== frameRank) {
        throw new RankError(
            `axis count ${axes.length} plus cell rank ${cellRank} must equal tensor rank ${shape.length}`,
        );
    }
    if (new Set(axes).size !== axes.length) throw new RankError('axis numbers must be unique');
    for (const axis of axes) {
        if (axis >= shape.length) throw new RankError(`axis out of bounds: ${axis}`);
    }
    return axes;
}

export interface OuterCells {
    readonly cellShape: readonly number[];
    readonly frameShape: readonly number[];
    readonly cellAt: (frameIndex: number) => RankValue;
}

/**
 * The cell rank an intrinsic or explicit rank gives an operand of rank `operandRank`.
 * `all` takes the whole operand; a negative rank counts down from the operand's own
 * rank, so `-1` selects its items and never goes below a scalar cell.
 */
export function resolveCellRank(rank: IntrinsicRank, operandRank: number): number {
    if (rank === 'all') return operandRank;
    return rank < 0 ? Math.max(0, operandRank + rank) : Math.min(rank, operandRank);
}

export function dyadicCells(
    value: RankValue,
    rank: IntrinsicRank,
    textAtoms = false,
): OuterCells {
    if (textAtoms && typeof value === 'string' && resolveCellRank(rank, 1) === 0) return textCells(value);
    if (!isRankArray(value)) {
        return { frameShape: [], cellShape: typeof value === 'string' ? [Array.from(value).length] : [], cellAt: () => value };
    }
    const cellRank = resolveCellRank(rank, value.shape.length);
    const frameShape = value.shape.slice(
        0, value.shape.length - cellRank,
    );
    const cellShape = cellRank === 0
        ? [] : value.shape.slice(-cellRank);
    const cellSize = arraySize(cellShape);
    return {
        frameShape,
        cellShape,
        cellAt(frameIndex) {
            if (frameShape.length === 0) return value;
            const start = frameIndex * cellSize;
            if (cellRank === 0) return arrayItem(value, start);
            if (arrayCells(value)) return atArray(value, coordinatesAt(frameShape, frameIndex).map(BigInt));
            return derivedArray(cellShape, [value], index =>
                arrayItem(value, start + index));
        },
    };
}

interface TensorCells {
    readonly frameShape: readonly number[];
    readonly cellShape: readonly number[];
    readonly cellAt: (frameIndex: number) => RankValue;
}

export function tensorCells(source: RankArray, frameAxes: readonly number[]): TensorCells {
    const frameShape = frameAxes.map(axis => source.shape[axis]);
    const frameSet = new Set(frameAxes);
    const cellAxes = source.shape.map((_, axis) => axis).filter(axis => !frameSet.has(axis));
    const cellShape = cellAxes.map(axis => source.shape[axis]);
    return {
        frameShape,
        cellShape,
        cellAt(frameIndex) {
            const sourceCoordinates = Array(source.shape.length).fill(0) as number[];
            coordinatesAt(frameShape, frameIndex).forEach((coordinate, index) => {
                sourceCoordinates[frameAxes[index]] = coordinate;
            });
            if (cellShape.length === 0) {
                return arrayItem(source, arrayOffset(source.shape, sourceCoordinates));
            }
            if (arrayCells(source)) return sliceArray(source, tensorSelection(source,
                sourceCoordinates.map((coordinate, axis) => frameSet.has(axis) ? BigInt(coordinate) : ALL_AXIS)));
            const offset = (cellIndex: number) => {
                const coordinates = [...sourceCoordinates];
                coordinatesAt(cellShape, cellIndex).forEach((coordinate, index) => {
                    coordinates[cellAxes[index]] = coordinate;
                });
                return arrayOffset(source.shape, coordinates);
            };
            return registerScalarView(derivedArray(cellShape, [source], index => arrayItem(source, offset(index))), source, offset);
        },
    };
}

/** Index UTF-16 offsets, retaining the original text rather than a character array. */
function textCells(value: string): OuterCells {
    const offsets: number[] = [];
    for (let offset = 0; offset < value.length;) {
        if ((offsets.length & 0xfff) === 0) checkpoint('indexing text cells');
        offsets.push(offset);
        offset += value.codePointAt(offset)! > 0xffff ? 2 : 1;
    }
    return { frameShape: [offsets.length], cellShape: [],
        cellAt: index => value.slice(offsets[index], offsets[index + 1] ?? value.length) };
}

/** No arbitrary object or lazy reader may be probed to establish eligibility. */
function storedScalarOperand(value: RankValue): boolean {
    return typeof value !== 'object' || prepareStoredScalarView(value) !== undefined;
}
