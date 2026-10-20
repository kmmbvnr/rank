import { MissingValueError } from './errors.js';

const surrogatePair = /[\uD800-\uDBFF][\uDC00-\uDFFF]/;

/** Without surrogate pairs, UTF-16 units already are Unicode code points.
 * Keep decimal/BMP text in its string storage instead of allocating characters
 * for every indexed read. Lone surrogates remain individual code points. */
export function textPoints(value: string): string | readonly string[] {
    return surrogatePair.test(value) ? [...value] : value;
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
