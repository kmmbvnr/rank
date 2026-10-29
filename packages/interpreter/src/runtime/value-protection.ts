import { RankError } from '../errors.js';
import type { RankValue } from './value.js';

// Shared records/maps use their storage identity, so a different wrapper cannot
// turn the same state into a writable value. Arrays retain their CoW contract.
const protectedValues = new WeakMap<object, string>();
function identity(value: RankValue): object | undefined {
    if (typeof value !== 'object') return undefined;
    switch (value.kind) {
        case 'record': case 'object': case 'index': case 'set': case 'counter': return value.entries;
        case 'queue': return 'values' in value ? value : value.items;
        case 'heap': case 'multiset': case 'fenwick': case 'segment': case 'dsu': case 'graph': case 'groups': return value;
        default: return undefined;
    }
}

export function valueProtection(value: RankValue): string | undefined {
    const key = identity(value);
    return key && protectedValues.get(key);
}

export function protectValue(value: RankValue, message: string): void {
    const key = identity(value);
    if (key && !protectedValues.has(key)) protectedValues.set(key, message);
}

export function checkValueMutable(value: RankValue): void {
    const message = valueProtection(value);
    if (message) throw new RankError(message, 'Scope');
}

export function inheritValueProtection(source: RankValue, target: RankValue): RankValue {
    const message = valueProtection(source);
    if (message) protectValue(target, message);
    return target;
}
