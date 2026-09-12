import { RankError } from './errors.js';
import {
    formatDate,
    isRankArray,
    isRankDate,
    isRankLabel,
    isRankRecord,
    type RankArray,
    type RankRecord,
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
    enterValue(value, active);
    const fields = [...value.entries]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([name, item]) => {
            const key = nestedValueKey(item, active);
            return `${name.length}:${name}${key.length}:${key}`;
        });
    active.delete(value);
    return `record:{${fields.join('')}}`;
}

function enterValue(value: object, active: Set<object>): void {
    if (active.has(value)) throw new RankError('cyclic values cannot be set elements');
    active.add(value);
}
