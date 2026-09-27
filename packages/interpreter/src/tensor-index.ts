import { RankError } from './errors.js';

export function safeDimension(value: bigint, name: string): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
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

