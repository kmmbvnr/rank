/** Negative axes count from the source rank; bounds are checked after normalization. */
export function normalizeAxis(axis: number, rank: number): number {
    return axis < 0 ? rank + axis : axis;
}
