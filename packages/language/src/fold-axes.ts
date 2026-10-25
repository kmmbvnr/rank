/** Partition normalized traversal axes before choosing the trailing input cell. */
export function foldAxisPartition(sourceRank: number, rank: number, traversal: readonly number[]) {
    const remaining = Array.from({ length: sourceRank }, (_, axis) => axis).filter(axis => !traversal.includes(axis));
    const boundary = remaining.length - rank;
    return {
        frameAxes: remaining.slice(0, boundary),
        cellAxes: remaining.slice(boundary),
    };
}
