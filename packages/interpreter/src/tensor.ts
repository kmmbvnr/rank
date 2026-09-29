import { denseScalarItems, derivedArray, ownedArray, readArrayItem } from './array-storage.js';
import { RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import type { RankArray, RankValue } from './value.js';

export function mapBroadcastArrays(
    left: RankArray,
    right: RankArray,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankArray {
    const shape = broadcastShape(left.shape, right.shape);
    const leftStrides = arrayStrides(left.shape);
    const rightStrides = arrayStrides(right.shape);
    const sameShape = left.shape.length === right.shape.length
        && left.shape.every((dimension, axis) => dimension === right.shape[axis]);
    return derivedArray(shape, [left, right], index => operation(
        arrayItem(left, sameShape ? index : broadcastOffset(index, shape, left.shape, leftStrides)),
        arrayItem(right, sameShape ? index : broadcastOffset(index, shape, right.shape, rightStrides)),
    ), true);
}

/**
 * Apply an elementwise operation at once when both operands are stored scalar
 * arrays (or numeric scalars), instead of stacking one lazy layer per operation.
 * Nothing unread is forced: an operand that is itself lazy declines, and an
 * operation that raises for some cell declines, so that cell raises only when
 * it is read, as in the lazy path.
 */
export function mapDenseArrays(
    left: RankValue,
    right: RankValue,
    operation: (left: RankValue, right: RankValue) => RankValue,
): RankArray | undefined {
    const leftArray = isArrayValue(left) ? left : undefined;
    const rightArray = isArrayValue(right) ? right : undefined;
    const leftItems = leftArray ? denseScalarItems(leftArray) : undefined;
    const rightItems = rightArray ? denseScalarItems(rightArray) : undefined;
    if (leftArray ? !leftItems : !isNumeric(left)) return undefined;
    if (rightArray ? !rightItems : !isNumeric(right)) return undefined;
    const shape = leftArray && rightArray
        ? broadcastShape(leftArray.shape, rightArray.shape) : (leftArray ?? rightArray!).shape;
    const size = shape.reduce((product, dimension) => product * dimension, 1);
    // A small array costs little to keep lazy; the layers only add up on large ones.
    if (size < DENSE_MIN_CELLS) return undefined;
    const same = !!leftArray && !!rightArray
        && leftArray.shape.length === rightArray.shape.length
        && leftArray.shape.every((dimension, axis) => dimension === rightArray.shape[axis]);
    const leftStrides = leftArray && arrayStrides(leftArray.shape);
    const rightStrides = rightArray && arrayStrides(rightArray.shape);
    const cells: RankValue[] = new Array(size);
    try {
        for (let index = 0; index < size; index += 1) {
            checkpoint('computing array');
            const a = leftItems
                ? leftItems[!rightArray || same ? index : broadcastOffset(index, shape, leftArray!.shape, leftStrides!)]
                : left;
            const b = rightItems
                ? rightItems[!leftArray || same ? index : broadcastOffset(index, shape, rightArray!.shape, rightStrides!)]
                : right;
            cells[index] = operation(a, b);
        }
    } catch (error) {
        if (error instanceof RankError) return undefined;
        throw error;
    }
    return ownedArray(cells, shape);
}

const DENSE_MIN_CELLS = 1024;
const isArrayValue =(value: RankValue): value is RankArray =>
    typeof value === 'object' && value !== null && (value as { kind?: string }).kind === 'array';
const isNumeric = (value: RankValue) => typeof value === 'number' || typeof value === 'bigint';

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

function broadcastOffset(
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

function arrayStrides(shape: readonly number[]): number[] {
    const strides = Array(shape.length).fill(1) as number[];
    for (let axis = shape.length - 2; axis >= 0; axis -= 1) {
        strides[axis] = strides[axis + 1] * shape[axis + 1];
    }
    return strides;
}

function arrayItem(value: RankArray, index: number): RankValue {
    return readArrayItem(value, index);
}
