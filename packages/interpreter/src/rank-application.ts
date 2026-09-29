import { arrayRevision, derivedArray, ownedArray, readArrayItem, registerArrayDependencies } from './array-storage.js';
import { completed, type Evaluation } from './execution.js';
import { RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { standardModules } from './modules/index.js';
import type { RuntimeModule } from './modules/types.js';
import { textFunctionSqlite } from './modules/sqlite.js';
import { mapSequence, sequence } from './sequence.js';
import { broadcastShape, mapBroadcastArrays } from './tensor.js';
import { arrayOffset, coordinatesAt, sameShape } from './tensor-index.js';
import { isRankArray, isRankSqliteExpression, isRankSequence, valueRank,
    type IntrinsicRank, type NativeFunction, type RankArray, type RankSequence, type RankValue } from './value.js';

const arrayItem = readArrayItem;
const DENSE_FRAME_CELLS = 1024;
const arraySize = (shape: readonly number[]): number =>
    shape.reduce((product, dimension) => product * dimension, 1);
function lazyArray(shape: readonly number[], itemAt: (index: number) => RankValue,
    fileFree = false): RankArray {
    let materialized: RankValue[] | undefined;
    return { kind: 'array', shape, itemAt,
        containsFiles: fileFree ? false : undefined,
        get items() {
            materialized ??= Array.from({ length: arraySize(shape) }, (_, index) => itemAt(index));
            return materialized;
        },
    };
}

/** Apply an operation to ranked cells and assemble its lazy framed result. */
export class RankApplication {
    constructor(
        private readonly invoke: (fn: NativeFunction, args: RankValue[]) => Evaluation<RankValue>,
        private readonly ownFiles: (value: RankValue) => void,
        private readonly standardFunctions: ReadonlyMap<RuntimeModule[string], NativeFunction>,
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
        if (typeof value === 'string') {
            if (cellRank >= 1) return this.invoke(fn, [value]);
            return completed(mapTextAtoms(value, atom => fn.call([atom]), fn.name));
        }
        if (isRankSequence(value)) {
            if (cellRank >= 1) return this.invoke(fn, [value]);
            return completed(mapSequence(value, fn.name, atom => fn.call([atom])));
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
        const a = dyadicCells(left, leftRank);
        const b = dyadicCells(right, rightRank);
        const frameShape = broadcastShape(
            a.frameShape, b.frameShape,
        );
        if (frameShape.length === 0) {
            return this.invoke(fn, [left, right]);
        }
        const applyCell = (x: RankValue, y: RankValue): RankValue => {
            const result = fn.call([x, y]);
            if (valueRank(result) !== 0) {
                throw new RankError(
                    `rank operation ${fn.name} must return a scalar`,
                );
            }
            this.ownFiles(result);
            return result;
        };
        // A pure builtin over scalar cells is computed at once: a lazy layer per
        // call makes a loop that rebinds its own result read back through every
        // earlier pass. A cell that raises leaves the lazy form, which raises
        // only when that cell is read.
        const frameSize = arraySize(frameShape);
        if (frameSize >= DENSE_FRAME_CELLS && leftRank === 0 && rightRank === 0
            && (a.frameShape.length === 0 || b.frameShape.length === 0 || sameShape(a.frameShape, b.frameShape))
            && this.isPureBuiltin(fn)) {
            const cells: RankValue[] = new Array(frameSize);
            try {
                for (let index = 0; index < frameSize; index += 1) {
                    if ((index & 0xfff) === 0) checkpoint('computing array');
                    cells[index] = applyCell(
                        a.cellAt(a.frameShape.length === 0 ? 0 : index),
                        b.cellAt(b.frameShape.length === 0 ? 0 : index));
                }
                return completed(ownedArray(cells, frameShape));
            } catch (error) {
                if (!(error instanceof RankError)) throw error;
            }
        }
        if (a.frameShape.length === 0) {
            return completed(lazyArray(frameShape, index =>
                applyCell(a.cellAt(0), b.cellAt(index)), true));
        }
        if (b.frameShape.length === 0) {
            return completed(lazyArray(frameShape, index =>
                applyCell(a.cellAt(index), b.cellAt(0)), true));
        }
        if (sameShape(a.frameShape, b.frameShape)) {
            return completed(lazyArray(frameShape, index =>
                applyCell(a.cellAt(index), b.cellAt(index)), true));
        }
        const leftCells = lazyArray(a.frameShape, a.cellAt);
        const rightCells = lazyArray(b.frameShape, b.cellAt);
        return completed(mapBroadcastArrays(
            leftCells,
            rightCells,
            applyCell,
        ));
    }

    private applyToTensorCells(
        value: RankArray,
        fn: Extract<RankValue, { kind: 'function' }>,
        frameAxes: readonly number[],
    ): RankValue {
        const cells = tensorCells(value, frameAxes);
        const frameSize = arraySize(cells.frameShape);
        if (frameSize === 0) {
            const resultShape = this.emptyFrameCellShape(fn, cells.cellShape) ?? [];
            return lazyArray([...cells.frameShape, ...resultShape], () => {
                throw new RankError('empty ranked result has no items');
            });
        }
        if (frameAxes.length === 0) return fn.call([cells.cellAt(0)]);

        const builtin = this.isPureBuiltin(fn);
        const results = new Map<number, RankValue>();
        let inputRevision: number | undefined;
        let materialized: RankValue[] | undefined;
        const refresh = () => {
            if (!builtin) return true;
            const current = arrayRevision(value);
            if (current === undefined || current !== inputRevision) {
                results.clear();
                materialized = undefined;
                if (current !== inputRevision) resultCellShape = undefined;
                inputRevision = current;
            }
            return current !== undefined;
        };
        let resultCellShape: readonly number[] | undefined;
        const resultAt = (frameIndex: number): RankValue => {
            const cacheable = refresh();
            const cached = results.get(frameIndex);
            if (cached !== undefined) return cached;
            const result = fn.call([cells.cellAt(frameIndex)]);
            const shape = isRankArray(result) ? result.shape : [];
            if (resultCellShape === undefined) {
                resultCellShape = [...shape];
            } else if (!sameShape(resultCellShape, shape)) {
                throw new RankError(
                    `rank results must have one shape: ${resultCellShape.join(' ')} and ${shape.join(' ')}`,
                );
            }
            this.ownFiles(result);
            if (cacheable) results.set(frameIndex, result);
            return result;
        };
        const outputShape = (): readonly number[] => {
            resultAt(0);
            return [...cells.frameShape, ...resultCellShape!];
        };

        const result: RankArray = {
            kind: 'array',
            get shape() {
                return outputShape();
            },
            itemAt(index) {
                outputShape();
                const cellSize = arraySize(resultCellShape!);
                const frameIndex = Math.floor(index / cellSize);
                const result = resultAt(frameIndex);
                return isRankArray(result) ? arrayItem(result, index % cellSize) : result;
            },
            get items() {
                const shape = outputShape();
                materialized ??= Array.from(
                    { length: arraySize(shape) },
                    (_, index) => this.itemAt!(index),
                );
                return materialized;
            },
        };
        return builtin ? registerArrayDependencies(result, [value]) : result;
    }

    private isPureBuiltin(fn: Extract<RankValue, { kind: 'function' }>): boolean {
        return ['core', 'numbers', 'linalg', 'stats', 'sequences', 'text'].some(module =>
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
        if (fn.monadicResultShape || !this.isPureBuiltin(fn)) return declared;
        const size = arraySize(cellShape);
        if (size > FILL_CELL_LIMIT) return undefined;
        const fill = cellShape.length === 0 ? 0n
            : ownedArray(Array.from({ length: size }, () => 0n), cellShape, true);
        try {
            const result = fn.call([fill]);
            return isRankArray(result) ? [...result.shape] : [];
        } catch (error) {
            if (error instanceof RankError) return undefined;
            throw error;
        }
    }

}

/** Larger fill cells cost more than an unknown result cell shape is worth. */
const FILL_CELL_LIMIT = 1 << 16;

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
    readonly frameShape: readonly number[];
    readonly cellAt: (frameIndex: number) => RankValue;
}

export function dyadicCells(
    value: RankValue,
    rank: IntrinsicRank,
): OuterCells {
    if (!isRankArray(value)) {
        return { frameShape: [], cellAt: () => value };
    }
    const cellRank = rank === 'all'
        ? value.shape.length
        : Math.min(rank, value.shape.length);
    const frameShape = value.shape.slice(
        0, value.shape.length - cellRank,
    );
    const cellShape = cellRank === 0
        ? [] : value.shape.slice(-cellRank);
    const cellSize = arraySize(cellShape);
    return {
        frameShape,
        cellAt(frameIndex) {
            if (frameShape.length === 0) return value;
            const start = frameIndex * cellSize;
            if (cellRank === 0) return arrayItem(value, start);
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
            return derivedArray(cellShape, [source], cellIndex => {
                const coordinates = [...sourceCoordinates];
                coordinatesAt(cellShape, cellIndex).forEach((coordinate, index) => {
                    coordinates[cellAxes[index]] = coordinate;
                });
                return arrayItem(source, arrayOffset(source.shape, coordinates));
            });
        },
    };
}

function mapTextAtoms(
    value: string,
    operation: (atom: string) => RankValue,
    name: string,
): RankSequence {
    const atoms = [...value];
    return sequence({
        name: `text ${name} rank 0`,
        size: { kind: 'exact', value: BigInt(atoms.length) },
        *iterate() {
            for (const atom of atoms) yield operation(atom);
        },
        at(index) {
            if (index >= BigInt(atoms.length)) return undefined;
            return operation(atoms[Number(index)]);
        },
    });
}

