import { numericSort, numericOrderItems } from '../numeric-collections.js';
import { ownedArray } from '../array-storage.js';
import { RankError } from '../errors.js';
import { interruptibleCallback } from '../interrupt.js';
import { orderedSource } from '../ordered-source.js';
import { compareOrderedValues, orderedKind, type OrderedKind } from '../ordered.js';
import { type RankValue, type RankArray } from '../value.js';

export function sortValue(value: RankValue, descending = false): RankValue {
    const fast = numericSort(value, descending);
    if (fast) return fast.values!;
    const source = orderedSource(value, 'sortable', 'sort');
    if (!source?.vector) throw new RankError('sort expects text or a rank-1 array');
    const items = source.vector();
    const kind = sortableKind(items, 'sort');
    items.sort(interruptibleCallback((left, right) => (descending ? -1 : 1) * compareOrderedValues(left, right, kind), 'sorting'));
    return source.build(items);
}

export function argsortValue(value: RankValue, descending = false): RankArray {
    const fast = numericSort(value, descending, 'indexes');
    if (fast) return fast.indexes!;
    const source = orderedSource(value, 'sortable', 'argsort');
    if (!source?.vector) throw new RankError('argsort expects text or a rank-1 array');
    const items = source.vector();
    const order = stableOrder(items, sortableKind(items, 'argsort'), descending);
    return ownedArray(order.map(index => BigInt(index)));
}

export function sortableKind(items: readonly RankValue[], operation: string): OrderedKind {
    if (items.length === 0) return 'numeric';
    const kinds = new Set(items.map(orderedKind));
    if (kinds.size !== 1) {
        throw new RankError(`${operation} array elements must have one comparable type`);
    }
    return [...kinds][0];
}

export function stableOrder(items: readonly RankValue[], kind: OrderedKind, descending = false): number[] {
    const fast = numericOrderItems(items, descending);
    if (fast) return fast;
    return items
        .map((_, position) => position)
        .sort(interruptibleCallback((left, right) =>
            (descending ? -1 : 1) * compareOrderedValues(items[left], items[right], kind) || left - right, 'sorting'));
}

/** Sort already-computed key rows lexicographically and stably. */
export function sortByKeys(
    items: readonly RankValue[],
    keys: readonly (readonly (RankValue | undefined)[])[],
    operation = 'sort by',
    indices = false,
    descending: readonly boolean[] = [],
): RankArray {
    if (items.length !== keys.length) throw new RankError(`${operation} key count mismatch`);
    const width = keys[0]?.length ?? 0;
    if (keys.some(key => key.length !== width)) {
        throw new RankError(`${operation} keys must have one shape`);
    }
    const kinds = Array.from({ length: width }, (_, column) => {
        const first = keys.find(row => row[column] !== undefined)?.[column];
        if (first === undefined) return undefined;
        const kind = orderedKind(first);
        for (const row of keys) {
            const value = row[column];
            if (value !== undefined && orderedKind(value) !== kind) {
                throw new RankError(`${operation} key values must have one comparable type`);
            }
        }
        return kind;
    });
    const entries = items.map((value, position) => ({ value, position, keys: keys[position] }));
    entries.sort(interruptibleCallback((left, right) => {
        for (let column = 0; column < width; column += 1) {
            const a = left.keys[column];
            const b = right.keys[column];
            if (a === undefined || b === undefined) {
                if (a !== b) return a === undefined ? 1 : -1;
                continue;
            }
            const order = compareOrderedValues(a, b, kinds[column]!);
            if (order !== 0) return descending[column] ? -order : order;
        }
        return left.position - right.position;
    }, 'sorting'));
    const result = ownedArray(entries.map(entry => indices ? BigInt(entry.position) : entry.value));
    if (!indices) Object.defineProperty(result, 'sortKeys', { value: entries.map(entry => entry.keys) });
    return result;
}

