import { RankError } from './errors.js';
import { isRankArray, isRankLabel, type RankArray, type RankValue } from './value.js';

export function setValueKey(value: RankValue): string {
    if (typeof value === 'bigint') return `number:${value}`;
    if (typeof value === 'number') {
        if (Number.isInteger(value) && Number.isFinite(value)) return `number:${BigInt(value)}`;
        return `real:${Object.is(value, -0) ? 0 : value}`;
    }
    if (typeof value === 'boolean') return `boolean:${value}`;
    if (typeof value === 'string') return `text:${JSON.stringify(value)}`;
    if (isRankLabel(value)) return `label:${value.name}`;
    if (isRankArray(value)) return arrayKey(value);
    throw new RankError('set values must be scalars or arrays');
}

function arrayKey(value: RankArray): string {
    const size = value.shape.reduce((product, dimension) => product * dimension, 1);
    const items: string[] = [];
    for (let index = 0; index < size; index += 1) {
        const key = setValueKey(value.itemAt?.(index) ?? value.items[index]);
        items.push(`${key.length}:${key}`);
    }
    return `array:${value.shape.join(',')}:[${items.join('')}]`;
}
