import { RankError } from '../errors.js';
import { formatValue, isRankArray, isRankBytes, isRankLabel, isRankQueue, isRankSequence, type RankArray, type RankValue } from '../value.js';
import { mapSequence } from '../sequence.js';
import { roundValue } from './numbers.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

const hexadecimalBytes = Array.from({ length: 256 }, (_, byte) =>
    byte.toString(16).padStart(2, '0'));

export const textModule: RuntimeModule = {
    join: () => native('join', 2, ([value, separator]) => {
        if (typeof separator !== 'string') throw new RankError('join separator must be text', 'TypeError');
        let items: Iterable<RankValue>;
        if (isRankArray(value) && value.shape.length === 1) items = value.items;
        else if (isRankQueue(value)) items = value.items;
        else if (isRankSequence(value)) {
            if (value.plan.size.kind === 'infinite') throw new RankError('join requires a finite sequence', 'TypeError');
            items = value.plan.iterate();
        } else throw new RankError('join expects a rank-1 collection; join matrix rows separately', 'TypeError');
        return Array.from(items, item => {
            if (typeof item === 'object' && !isRankLabel(item)) {
                throw new RankError('join expects scalar elements; join nested rows separately', 'TypeError');
            }
            return formatValue(item);
        }).join(separator);
    }),
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
        let result = '';
        for (const byte of value.data) result += hexadecimalBytes[byte];
        return result;
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

export function formattedText(value: RankValue, format: string): RankValue {
    const match = /^\.(0|[1-9][0-9]*)f$/.exec(format);
    if (!match) throw new RankError('text format must be .Nf, for example .6f', 'InvalidFormat', format);
    const places = Number(match[1]);
    if (places > 100) throw new RankError('text precision must be between 0 and 100', 'InvalidFormat', format);
    const scalar = (item: RankValue): string => {
        if (typeof item !== 'number' && typeof item !== 'bigint') {
            throw new RankError('formatted text expects numeric input', 'TypeError');
        }
        if (typeof item === 'number' && !Number.isFinite(item)) return formatValue(item);
        const rounded = typeof item === 'bigint' || Number.isInteger(item)
            ? item : roundValue(item, BigInt(places));
        // Expand the rounded decimal representation instead of toFixed, which
        // switches to exponential notation for large numbers.
        const [coefficient, exponent = '0'] = formatValue(rounded).split('e');
        const negative = coefficient.startsWith('-');
        const unsigned = negative ? coefficient.slice(1) : coefficient;
        const [whole, fraction = ''] = unsigned.split('.');
        const digits = whole + fraction;
        const point = whole.length + Number(exponent);
        const integer = point <= 0 ? '0' : digits.slice(0, point).padEnd(point, '0');
        const decimal = (point < 0 ? '0'.repeat(-point) + digits : digits.slice(point)).padEnd(places, '0').slice(0, places);
        const sign = negative && /[1-9]/.test(integer + decimal) ? '-' : '';
        return sign + integer + (places ? '.' + decimal : '');
    };
    if (isRankSequence(value)) return mapSequence(value, 'text', scalar);
    if (isRankArray(value)) return { kind: 'array', shape: value.shape, items: value.items.map(scalar) };
    return scalar(value);
}

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
