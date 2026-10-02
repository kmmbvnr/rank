import { RankError } from './errors.js';
import { trackedKeyedCollections } from './interrupt.js';
import {
    formatDate,
    isRankArray,
    isRankDate,
    isRankLabel,
    isRankRecord,
    isRankSet,
    type RankArray,
    type RankCounter,
    type RankRecord,
    type RankSet,
    type RankValue,
} from './value.js';

export function setValueKey(value: RankValue): string {
    return nestedValueKey(value, new Set());
}

function nestedValueKey(value: RankValue, active: Set<object>): string {
    if (typeof value === 'bigint') return `number:${value}`;
    if (typeof value === 'number') {
        if (Number.isInteger(value) && Number.isFinite(value)) return `number:${BigInt(value)}`;
        return `real:${Object.is(value, -0) ? 0 : value}`;
    }
    if (typeof value === 'boolean') return `boolean:${value}`;
    if (typeof value === 'string') return `text:${JSON.stringify(value)}`;
    if (isRankLabel(value)) return `label:${value.name}`;
    if (isRankDate(value)) return `${value.kind}:${formatDate(value)}`;
    if (isRankArray(value)) return arrayKey(value, active);
    if (isRankRecord(value)) return recordKey(value, active);
    throw new RankError('set values must be scalars, arrays or records');
}

function arrayKey(value: RankArray, active: Set<object>): string {
    enterValue(value, active);
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    const items: string[] = [];
    for (let index = 0; index < size; index += 1) {
        const key = nestedValueKey(value.itemAt?.(index) ?? value.items[index], active);
        items.push(`${key.length}:${key}`);
    }
    active.delete(value);
    return `array:${value.shape.join(',')}:[${items.join('')}]`;
}

function recordKey(value: RankRecord, active: Set<object>): string {
    // Membership tests rebuild this key on every `in`; a flat record keeps it until a field write.
    if (value.key !== undefined) return value.key;
    enterValue(value, active);
    let flat = true;
    const fields = [...value.entries]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([name, item]) => {
            if (isRankRecord(item) || isRankArray(item)) flat = false;
            const key = nestedValueKey(item, active);
            return `${name.length}:${name}${key.length}:${key}`;
        });
    active.delete(value);
    const key = `record:{${fields.join('')}}`;
    if (flat) value.key = key;
    return key;
}

function enterValue(value: object, active: Set<object>): void {
    if (active.has(value)) throw new RankError('cyclic values cannot be set elements');
    active.add(value);
}

/**
 * Elements are stored under the key they had when added, but a record or array
 * element keeps its identity. During an inspected run, recompute every key and
 * fail when one has moved, since membership would otherwise miss an element
 * that is still stored.
 */
export function verifyKeyedCollections(): void {
    for (const collection of trackedKeyedCollections() as Iterable<RankSet | RankCounter>) {
        for (const [key, entry] of collection.entries) {
            const value = isRankSet(collection) ? entry as RankValue : (entry as { value: RankValue }).value;
            // Scalars are immutable, so only records and arrays can have moved.
            if (!isRankRecord(value) && !isRankArray(value)) continue;
            let current: string | undefined;
            try {
                current = setValueKey(value);
            } catch (error) {
                if (!(error instanceof RankError)) throw error;
            }
            if (current !== key) {
                throw new RankError(`${collection.kind} element was modified after it was added; `
                    + 'remove it, change it and add it again');
            }
        }
    }
}
