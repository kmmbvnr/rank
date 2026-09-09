import { RankError } from '../errors.js';
import { formatValue, isRankBytes, isRankLabel, type RankArray } from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const textModule: RuntimeModule = {
    split: () => native('split', 2, arguments_ => {
        const [value, separator] = arguments_;
        if (typeof value !== 'string' || typeof separator !== 'string') {
            throw new RankError('split expects text and a text separator');
        }
        const items = separator.length === 0 ? [...value] : value.split(separator);
        return textArray(items);
    }),
    startswith: () => native('startswith', 2, arguments_ => {
        const [value, prefix] = arguments_;
        if (typeof value !== 'string' || typeof prefix !== 'string') {
            throw new RankError('startswith expects text and a text prefix');
        }
        return value.startsWith(prefix);
    }),
    hex: () => native('hex', 1, arguments_ => {
        const value = arguments_[0];
        if (!isRankBytes(value)) throw new RankError('hex expects bytes');
        return [...value.data].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }),
    text: () => native('text', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value === 'object' && !isRankLabel(value)) {
            throw new RankError('text expects a scalar value');
        }
        return formatValue(value);
    }),
    reverse: () => native('reverse', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value !== 'string') throw new RankError('reverse expects text');
        return [...value].reverse().join('');
    }),
    integer: () => native('integer', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value !== 'string') throw new RankError('integer expects text');
        if (!/^[+-]?[0-9]+$/.test(value)) {
            throw new RankError(`invalid integer text: ${value}`, 'InvalidNumber', value);
        }
        return BigInt(value);
    }, 1),
};

function textArray(items: string[]): RankArray {
    return { kind: 'array', items, shape: [items.length] };
}
