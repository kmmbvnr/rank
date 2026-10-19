import { ownedArray } from '../array-storage.js';
import { RankError } from '../errors.js';
import { interruptibleCallback } from '../interrupt.js';
import { orderedSource } from '../ordered-source.js';
import { compareOrderedValues, orderedKind, type OrderedKind } from '../ordered.js';
import { type RankValue, type RankArray } from '../value.js';

export function sortValue(value: RankValue, descending = false): RankValue {
    const source = orderedSource(value, 'sortable', 'sort');
    if (!source?.vector) throw new RankError('sort expects text or a rank-1 array');
    const items = source.vector();
    const kind = sortableKind(items, 'sort');
    items.sort(interruptibleCallback((left, right) => (descending ? -1 : 1) * compareOrderedValues(left, right, kind), 'sorting'));
    return source.build(items);
}

export function argsortValue(value: RankValue, descending = false): RankArray {
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
    return items
        .map((_, position) => position)
        .sort(interruptibleCallback((left, right) =>
            (descending ? -1 : 1) * compareOrderedValues(items[left], items[right], kind) || left - right, 'sorting'));
}

