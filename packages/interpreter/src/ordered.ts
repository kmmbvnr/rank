import { RankError } from './errors.js';
import { formatDate, isRankDate, isRankLabel, type RankDate, type RankDateTime, type RankValue } from './value.js';

export type OrderedKind = 'numeric' | 'text' | 'boolean' | 'symbol' | 'date' | 'datetime';

/** Return the scalar ordering shared by sort and ordered containers. */
export function orderedKind(value: RankValue): OrderedKind {
    if (typeof value === 'bigint' || typeof value === 'number') return 'numeric';
    if (typeof value === 'string') return 'text';
    if (typeof value === 'boolean') return 'boolean';
    if (isRankLabel(value)) return 'symbol';
    if (isRankDate(value)) return value.kind;
    throw new RankError('ordered values must be comparable scalars', 'TypeError');
}

/** Compare two values using Rank's scalar ordering. */
export function compareOrderedValues(
    left: RankValue,
    right: RankValue,
    kind: OrderedKind,
): number {
    if (orderedKind(left) !== kind || orderedKind(right) !== kind) {
        throw new RankError('ordered values must have one comparable type', 'TypeError');
    }
    if (kind === 'numeric') {
        const a = left as bigint | number;
        const b = right as bigint | number;
        return a < b ? -1 : a > b ? 1 : 0;
    }
    if (kind === 'text') return compareText(left as string, right as string);
    if (kind === 'boolean') return Number(left as boolean) - Number(right as boolean);
    if (kind === 'date' || kind === 'datetime') {
        return compareText(formatDate(left as RankDate | RankDateTime),
            formatDate(right as RankDate | RankDateTime));
    }
    return compareText(
        (left as { name: string }).name,
        (right as { name: string }).name,
    );
}

function compareText(left: string, right: string): number {
    const a = [...left];
    const b = [...right];
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const difference = (a[index].codePointAt(0) ?? 0) - (b[index].codePointAt(0) ?? 0);
        if (difference !== 0) return difference;
    }
    return a.length - b.length;
}
