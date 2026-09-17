import { RankError } from './errors.js';
import { formatDate, isRankDate, isRankLabel, isRankRecord,
    type RankDate, type RankDateTime, type RankRecord, type RankValue } from './value.js';

export type OrderedKind = 'numeric' | 'text' | 'boolean' | 'symbol' | 'date' | 'datetime' | 'record';

/** Return the ordering kind shared by comparisons, sort and ordered containers. */
export function orderedKind(value: RankValue): OrderedKind {
    if (typeof value === 'bigint' || typeof value === 'number') return 'numeric';
    if (typeof value === 'string') return 'text';
    if (typeof value === 'boolean') return 'boolean';
    if (isRankLabel(value)) return 'symbol';
    if (isRankDate(value)) return value.kind;
    if (isRankRecord(value)) return 'record';
    throw new RankError('ordered values must be comparable scalars', 'TypeError');
}

/** Compare two values using Rank's shared ordering. */
export function compareOrderedValues(
    left: RankValue,
    right: RankValue,
    kind: OrderedKind,
): number {
    return compareValues(left, right, kind, new WeakMap());
}

function compareValues(
    left: RankValue,
    right: RankValue,
    kind: OrderedKind,
    active: WeakMap<RankRecord, WeakSet<RankRecord>>,
): number {
    if (orderedKind(left) !== kind || orderedKind(right) !== kind) {
        throw new RankError('ordered values must have one comparable type', 'TypeError');
    }
    if (kind === 'record') return compareRecords(left as RankRecord, right as RankRecord, active);
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

function compareRecords(
    left: RankRecord,
    right: RankRecord,
    active: WeakMap<RankRecord, WeakSet<RankRecord>>,
): number {
    const names = [...left.entries.keys()];
    const otherNames = [...right.entries.keys()];
    if (names.length !== otherNames.length || names.some((name, index) => name !== otherNames[index])) {
        throw new RankError('ordered records must have the same fields in the same order', 'TypeError');
    }
    if (left === right) return 0;
    if (active.get(left)?.has(right)) {
        throw new RankError('cyclic records cannot be ordered', 'TypeError');
    }
    const peers = active.get(left) ?? new WeakSet<RankRecord>();
    peers.add(right);
    active.set(left, peers);
    try {
        for (const name of names) {
            const a = left.entries.get(name)!;
            const b = right.entries.get(name)!;
            const order = compareValues(a, b, orderedKind(a), active);
            if (order !== 0) return order;
        }
        return 0;
    } finally {
        peers.delete(right);
    }
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
