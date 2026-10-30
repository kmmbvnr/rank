import { RankError } from '../errors.js';
import type { RankValue } from '../value.js';

/** Resolve reshape metadata without reading source cells. Count is demanded
 * only for an inferred dimension, so one-shot sources are consumed once. */
export function reshapeDimensions(dimensions: readonly (RankValue | undefined)[], count: () => bigint): number[] {
    const inferred = dimensions.indexOf(undefined);
    if (dimensions.filter(item => item === undefined).length > 1) {
        throw new RankError('reshape accepts at most one inferred dimension #', 'DimensionMismatch');
    }
    if (!dimensions.every(item => item === undefined || typeof item === 'bigint')) {
        throw new RankError('reshape dimensions must be integers');
    }
    const dimension = (value: bigint): number => {
        if (value < 0n) throw new RankError(`reshape dimension must be nonnegative: ${value}`);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RankError(`reshape dimension is too large: ${value}`);
        return Number(value);
    };
    const shape = dimensions.map(item => item === undefined ? 1 : dimension(item as bigint));
    if (inferred >= 0) {
        const product = shape.reduce((total, size) => total * BigInt(size), 1n);
        if (product === 0n) throw new RankError('reshape cannot infer # when another dimension is zero', 'DimensionMismatch');
        const size = count();
        if (size % product !== 0n) {
            throw new RankError(`reshape cannot divide ${size} elements into dimensions with product ${product}`, 'DimensionMismatch');
        }
        shape[inferred] = dimension(size / product);
    }
    return shape;
}

/** First-axis take/drop layout; callers validate a nonnegative integer count. */
export function arraySliceLayout(source: readonly number[], count: bigint, drop: boolean) {
    const length = source[0];
    const clipped = Number(count < BigInt(length) ? count : BigInt(length));
    const cellSize = source.slice(1).reduce((a, b) => a * b, 1);
    return { shape: [drop ? length - clipped : clipped, ...source.slice(1)], offset: drop ? clipped * cellSize : 0 };
}

export function trailingCells(operand: readonly number[], result: readonly number[]): number {
    if (operand.length === result.length) return operand.every((size, axis) => size === result[axis]) ? 0 : -1;
    if (operand.length > result.length) return -1;
    const offset = result.length - operand.length;
    return operand.every((size, axis) => size === result[offset + axis])
        ? operand.reduce((product, size) => product * size, 1) : -1;
}

export function broadcastShape(
    left: readonly number[],
    right: readonly number[],
): readonly number[] {
    const rank = Math.max(left.length, right.length);
    const shape = Array(rank).fill(1) as number[];
    for (let offset = 1; offset <= rank; offset += 1) {
        const a = left.at(-offset) ?? 1;
        const b = right.at(-offset) ?? 1;
        if (a !== b && a !== 1 && b !== 1) {
            throw new RankError(
                `shape mismatch: ${left.join(',')} and ${right.join(',')}`,
                'DimensionMismatch',
            );
        }
        shape[rank - offset] = a === 1 ? b : b === 1 ? a : a;
    }
    return shape;
}

/** Rank broadcasts leading frames and trailing cells independently. Inserting
 * singleton axes aligns both parts without changing either operand's order. */
export function rankedBroadcastShapes(left: readonly number[], right: readonly number[], ranks: readonly [number, number]) {
    const split = (shape: readonly number[], rank: number) => {
        const cells = Math.min(shape.length, rank < 0 ? Math.max(0, shape.length + rank) : rank);
        return [shape.slice(0, shape.length - cells), shape.slice(shape.length - cells)];
    };
    const [leftFrame, leftCell] = split(left, ranks[0]);
    const [rightFrame, rightCell] = split(right, ranks[1]);
    const frame = broadcastShape(leftFrame, rightFrame);
    const cell = broadcastShape(leftCell, rightCell);
    const align = (sourceFrame: readonly number[], sourceCell: readonly number[]) => [
        ...Array(frame.length - sourceFrame.length).fill(1) as number[], ...sourceFrame,
        ...Array(cell.length - sourceCell.length).fill(1) as number[], ...sourceCell,
    ];
    return { shape: [...frame, ...cell], left: align(leftFrame, leftCell), right: align(rightFrame, rightCell) };
}

export function broadcastOffset(
    index: number,
    resultShape: readonly number[],
    sourceShape: readonly number[],
    sourceStrides: readonly number[],
): number {
    const leading = resultShape.length - sourceShape.length;
    let remaining = index;
    let offset = 0;
    for (let axis = resultShape.length - 1; axis >= 0; axis -= 1) {
        const coordinate = remaining % resultShape[axis];
        remaining = Math.floor(remaining / resultShape[axis]);
        const sourceAxis = axis - leading;
        if (sourceAxis >= 0 && sourceShape[sourceAxis] !== 1) {
            offset += coordinate * sourceStrides[sourceAxis];
        }
    }
    return offset;
}

export function arrayStrides(shape: readonly number[]): number[] {
    const strides = Array(shape.length).fill(1) as number[];
    for (let axis = shape.length - 2; axis >= 0; axis -= 1) {
        strides[axis] = strides[axis + 1] * shape[axis + 1];
    }
    return strides;
}
