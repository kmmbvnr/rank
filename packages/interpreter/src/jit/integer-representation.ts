/** Physical representation is independent of Rank's integer type. BigInt
 * needs no finite range proof; Number and Int32 must prove exact conversion.
 * Bounds describe values, not profitability or permission to mutate storage. */
export type IntegerRepresentation = 'int32' | 'safe-number' | 'bigint';
export type IntegerBounds = readonly [number, number];

const limits = {
    int32: [-2147483648, 2147483647],
    'safe-number': [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
} as const;

export function fitsIntegerRepresentation(bounds: IntegerBounds | undefined, representation: IntegerRepresentation): boolean {
    if (representation === 'bigint') return true;
    if (!bounds || !bounds.every(Number.isSafeInteger) || bounds[0] > bounds[1]) return false;
    const [min, max] = limits[representation];
    return bounds[0] >= min && bounds[1] <= max;
}

/** Admission guard, not a language conversion: real Number inputs remain real.
 * Mixed regions request BigInt for their existing wide scalar registers. */
export function integerInput(value: unknown, representation: IntegerRepresentation): number | bigint | undefined {
    if (typeof value !== 'bigint') return undefined;
    if (representation === 'bigint') return value;
    const number = Number(value);
    return fitsIntegerRepresentation([number, number], representation) ? number : undefined;
}
