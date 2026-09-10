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
    const cache = new Map<number, RankValue>();
    const itemAt = (index: number): RankValue => {
        const cached = cache.get(index);
        if (cached !== undefined) return cached;
        const result = operation(
            arrayItem(left, broadcastOffset(index, shape, left.shape, leftStrides)),
            arrayItem(right, broadcastOffset(index, shape, right.shape, rightStrides)),
        );
        cache.set(index, result);
        return result;
    };
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape,
        itemAt,
        containsFiles: false,
        get items() {
            materialized ??= Array.from(
                { length: arraySize(shape) },
                (_, index) => itemAt(index),
            );
            return materialized;
        },
    };
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

function arraySize(shape: readonly number[]): number {
    return shape.reduce((product, dimension) => product * dimension, 1);
}

function arrayItem(value: RankArray, index: number): RankValue {
    return value.itemAt?.(index) ?? value.items[index];
}
