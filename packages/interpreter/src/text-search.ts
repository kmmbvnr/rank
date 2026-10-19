/** Text positions are Unicode code points, like text addressing and iteration. */
export function isSingleCodePoint(value: string): boolean {
    return value.length === 1 || value.length === 2 && value.codePointAt(0)! > 0xffff;
}

/** Shared text search boundary for first-match and all-match consumers. */
export function* textMatchPositions(source: string, target: string): IterableIterator<bigint> {
    let position = 0n;
    for (const point of source) {
        if (point === target) yield position;
        position += 1n;
    }
}
