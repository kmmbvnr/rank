import { MissingValueError } from './errors.js';

/** Text positions and lengths count Unicode code points, including lone surrogates. */
export function textPoints(value: string): readonly string[] {
    return [...value];
}

export function textLength(value: string): number {
    return textPoints(value).length;
}

/** Scalar text addressing retains its own missing-value errors. Axis selection
 * checks array-style bounds before reading the same code-point storage. */
export function textAt(value: string, index: bigint): string {
    const points = textPoints(value);
    if (index < 0n) throw new MissingValueError('text index out of bounds');
    if (index >= BigInt(points.length)) throw new MissingValueError(`text index out of bounds: ${index}`);
    return points[Number(index)];
}
