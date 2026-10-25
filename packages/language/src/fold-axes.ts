/** Ranked folds always name their traversal axis explicitly. */
export function foldAxisDiagnostic(operation: string, hasRank: boolean, hasAxes: boolean): string | undefined {
    return hasRank && !hasAxes
        ? `${operation} with rank requires an explicit axis; specify rank R axis N`
        : undefined;
}

/** Partition normalized traversal axes before choosing the trailing input cell. */
export function foldAxisPartition(sourceRank: number, rank: number, traversal: readonly number[]) {
    const remaining = Array.from({ length: sourceRank }, (_, axis) => axis).filter(axis => !traversal.includes(axis));
    const boundary = remaining.length - rank;
    return {
        frameAxes: remaining.slice(0, boundary),
        cellAxes: remaining.slice(boundary),
    };
}
