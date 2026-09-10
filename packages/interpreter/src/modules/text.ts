import { RankError } from '../errors.js';
import { formatValue, isRankArray, isRankBytes, isRankLabel, type RankArray, type RankValue } from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const textModule: RuntimeModule = {
    split: () => native('split', 2, arguments_ => {
        const [value, separator] = arguments_;
        if (typeof value !== 'string') {
            throw new RankError('split expects text and a text separator or separator array');
        }
        const separators = splitSeparators(separator);
        if (separators.length > 1 && separators.includes('')) {
            throw new RankError('an empty split separator must be used alone');
        }
        const items = separators.length === 0
            ? [value]
            : separators[0] === ''
                ? [...value]
                : value.split(new RegExp(separators.map(escapeRegex).join('|'), 'gu'));
        return textArray(items);
    }),
    parse: () => native('parse', 2, arguments_ => {
        const [value, format] = arguments_;
        if (typeof value !== 'string' || typeof format !== 'string') {
            throw new RankError('parse expects text and a text format');
        }
        return parseText(value, format);
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
    codepoint: () => native('codepoint', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value !== 'string' || [...value].length !== 1) {
            throw new RankError('codepoint expects one Unicode character');
        }
        return BigInt(value.codePointAt(0)!);
    }),
    character: () => native('character', 1, arguments_ => {
        const value = arguments_[0];
        if (typeof value !== 'bigint') {
            throw new RankError('character expects an integer code point');
        }
        if (value < 0n || value > 0x10ffffn || (value >= 0xd800n && value <= 0xdfffn)) {
            throw new RankError(`invalid Unicode code point: ${value}`);
        }
        return String.fromCodePoint(Number(value));
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

function splitSeparators(value: RankValue): string[] {
    if (typeof value === 'string') return [value];
    if (!isRankArray(value) || value.shape.length !== 1
        || !value.items.every(item => typeof item === 'string')) {
        throw new RankError('split expects text and a text separator or separator array');
    }
    return value.items as string[];
}

function parseText(value: string, format: string): RankArray {
    const captures: Array<'integer' | 'real' | 'word' | 'text'> = [];
    let pattern = '^';

    for (let index = 0; index < format.length;) {
        if (format[index] !== '/') {
            const start = index;
            while (index < format.length && format[index] !== '/') index += 1;
            pattern += escapeRegex(format.slice(start, index));
            continue;
        }

        if (format[index + 1] === '/') {
            pattern += '/';
            index += 2;
            continue;
        }

        const directive = /^\/(integer|real|word|text)/.exec(format.slice(index));
        if (!directive) {
            throw new RankError(`unknown parse directive at position ${index}`, 'InvalidFormat', format);
        }
        const kind = directive[1] as typeof captures[number];
        captures.push(kind);
        pattern += capturePattern(kind);
        index += directive[0].length;
    }

    const match = new RegExp(`${pattern}$`, 'u').exec(value);
    if (!match) throw new RankError(`text does not match format: ${format}`, 'InvalidText', value);

    const items = captures.map((kind, index) => convertCapture(kind, match[index + 1]));
    return { kind: 'array', items, shape: [items.length] };
}

function capturePattern(kind: 'integer' | 'real' | 'word' | 'text'): string {
    if (kind === 'integer') return '([+-]?[0-9]+)';
    if (kind === 'real') return '([+-]?[0-9]+\\.[0-9]+)';
    if (kind === 'word') return '(\\S+)';
    return '(.*?)';
}

function convertCapture(
    kind: 'integer' | 'real' | 'word' | 'text',
    value: string,
): RankValue {
    if (kind === 'integer') return BigInt(value);
    if (kind === 'real') return Number(value);
    return value;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
