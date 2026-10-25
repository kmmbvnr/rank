import { normalizeAxis } from '@arrrank/language';
import { RankError } from './errors.js';

export function safeDimension(value: bigint, name: string): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`${name} is too large: ${value}`);
    }
    return Number(value);
}

export function coordinatesAt(shape: readonly number[], index: number): number[] {
    const result = Array(shape.length).fill(0) as number[];
    for (let axis = shape.length - 1; axis >= 0; axis -= 1) {
        result[axis] = index % shape[axis];
        index = Math.floor(index / shape[axis]);
    }
    return result;
}

export function arrayOffset(shape: readonly number[], coordinates: readonly number[]): number {
    return coordinates.reduce((offset, coordinate, axis) => offset * shape[axis] + coordinate, 0);
}


export function sameShape(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length
        && left.every((dimension, index) => dimension === right[index]);
}


export function checkedArrayDimension(dimension: bigint): number {
    if (dimension < 0n) throw new RankError(`array dimension must be nonnegative: ${dimension}`);
    if (dimension > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError(`array dimension is too large: ${dimension}`);
    }
    return Number(dimension);
}

/** Resolve public axis modifiers before selecting layouts or optimized kernels. */
export function resolveAxis(axis: number, rank: number, error?: (axis: number) => RankError): number {
    const normalized = normalizeAxis(axis, rank);
    if (!Number.isSafeInteger(axis) || normalized < 0 || normalized >= rank) {
        throw error?.(axis) ?? new RankError(`axis out of bounds: ${axis}`);
    }
    return normalized;
}

export function resolveAxes(axes: readonly number[], rank: number, operation?: string): readonly number[] {
    const normalized = axes.map(axis => resolveAxis(axis, rank, operation
        ? axis => new RankError(`array has no axis ${axis}`) : undefined));
    if (new Set(normalized).size !== normalized.length) {
        throw new RankError(operation ? `${operation} axes must be unique` : 'axis numbers must be unique');
    }
    return normalized;
}
