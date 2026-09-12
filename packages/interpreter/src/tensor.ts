import { derivedArray, readArrayItem } from './array-storage.js';
import { RankError } from './errors.js';
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
