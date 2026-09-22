import { interruptibleCallback } from '../interrupt.js';
import { RankError } from '../errors.js';
import { formatValue, isRankArray, isRankBytes, isRankDate, isRankLabel, isRankQueue, isRankSequence, isRankSqliteExpression, type RankArray, type RankBytes, type RankValue } from '../value.js';
import { withTypedCalls } from '../typed-native.js';
import { mapSequence } from '../sequence.js';
import { derivedArray, readArrayItem } from '../array-storage.js';
import { mapBroadcastArrays } from '../tensor.js';
import { roundValue } from './numbers.js';
import { textFunctionSqlite } from './sqlite.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

const hexadecimalBytes = Array.from({ length: 256 }, (_, byte) =>
    byte.toString(16).padStart(2, '0'));

export const textModule: RuntimeModule = {
    words: () => native('words', 1, ([value]) => {
        if (typeof value !== 'string') throw new RankError('words expects text', 'TypeError');
        return textArray(tokenize(value));
    }),
    vocab: () => native('vocab', 2, ([value, limit]) => {
        if (!isRankArray(value) || value.shape.length !== 1) {
            throw new RankError('vocab expects a rank-1 text array', 'DimensionMismatch');
        }
        if (typeof limit !== 'bigint' || limit < 0n) {
            throw new RankError('vocab limit must be a nonnegative integer', 'DomainError');
        }
        const frequency = new Map<string, number>();
        for (const item of value.items) {
            if (typeof item !== 'string') throw new RankError('vocab expects text elements', 'TypeError');
            for (const word of tokenize(item)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
        }
        const items = [...frequency.keys()]
            .sort(interruptibleCallback((left, right) => frequency.get(right)! - frequency.get(left)!
                || compareCodepoints(left, right), 'sorting'))
            .slice(0, Number(limit));
        return textArray(items);
    }),
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
            if (typeof item === 'object' && !isRankLabel(item) && !isRankDate(item)) {
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
    startswith: () => withTypedCalls(native('startswith', 2, ([value, prefix]) => startsWith(value, prefix)), {
        'text,text': arguments_ => (arguments_[0] as string).startsWith(arguments_[1] as string),
        'bytes,bytes': arguments_ => bytesStartWith(arguments_[0] as RankBytes, arguments_[1] as RankBytes),
    }),
    lower: () => withTypedCalls(native('lower', 1, ([value]) => {
        if (isRankArray(value)) {
            return mapTextArguments([value], args => lowerText(args[0]));
        }
        if (isRankSqliteExpression(value)) return textFunctionSqlite('rank_lower', [value]);
        return lowerText(value);
    }), { text: arguments_ => (arguments_[0] as string).toLowerCase() }),
    lpad: () => native('lpad', 3, arguments_ => {
        if (arguments_.some(isRankArray)) {
            return mapTextArguments(arguments_, args => lpadText(args[0], args[1], args[2]));
        }
        const [value, width, fill] = arguments_;
        if (isRankSqliteExpression(value) || isRankSqliteExpression(width)
            || isRankSqliteExpression(fill)) {
            return textFunctionSqlite('rank_lpad', arguments_);
        }
        return lpadText(value, width, fill);
    }),
    translate: () => native('translate', 3, arguments_ => {
        if (arguments_.some(isRankArray)) {
            return mapTextArguments(arguments_, args => translateText(args[0], args[1], args[2]));
        }
        const [value, chars, replacement] = arguments_;
        if (arguments_.some(isRankSqliteExpression)) {
            return textFunctionSqlite('rank_translate', arguments_);
        }
        return translateText(value, chars, replacement);
    }),
    hex: () => native('hex', 1, arguments_ => {
        const value = arguments_[0];
        if (!isRankBytes(value)) throw new RankError('hex expects bytes');
        let result = '';
        for (const byte of value.data) result += hexadecimalBytes[byte];
        return result;
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

};

function startsWith(value: RankValue, prefix: RankValue): RankValue {
    // Bytes are whole binary values here; ordinary arrays keep text broadcasting.
    const valueArray = isRankArray(value) && !isRankBytes(value);
    const prefixArray = isRankArray(prefix) && !isRankBytes(prefix);
    if (valueArray && prefixArray) return mapBroadcastArrays(value, prefix, startsWith);
    if (valueArray) {
        return derivedArray(value.shape, [value], index =>
            startsWith(readArrayItem(value, index), prefix), true);
    }
    if (prefixArray) {
        return derivedArray(prefix.shape, [prefix], index =>
            startsWith(value, readArrayItem(prefix, index)), true);
    }
    if (isRankSqliteExpression(value) || isRankSqliteExpression(prefix)) {
        return textFunctionSqlite('rank_startswith', [value, prefix], true);
    }
    if (isRankBytes(value) && isRankBytes(prefix)) {
        return bytesStartWith(value, prefix);
    }
    if (typeof value !== 'string' || typeof prefix !== 'string') {
        throw new RankError('startswith expects text and a text prefix, or bytes and a byte prefix');
    }
    return value.startsWith(prefix);
}

function bytesStartWith(value: RankBytes, prefix: RankBytes): boolean {
    if (prefix.data.length > value.data.length) return false;
    for (let index = 0; index < prefix.data.length; index += 1) {
        if (value.data[index] !== prefix.data[index]) return false;
    }
    return true;
}

function mapTextArguments(
    values: RankValue[], call: (arguments_: RankValue[]) => RankValue,
): RankArray {
    const arrays = values.filter(isRankArray);
    const shape = arrays[0].shape;
    if (arrays.some(value => value.shape.length !== shape.length
        || value.shape.some((size, axis) => size !== shape[axis]))) {
        throw new RankError('text argument arrays must have the same shape', 'DimensionMismatch');
    }
    return derivedArray(shape, arrays, index =>
        call(values.map(value => isRankArray(value) ? readArrayItem(value, index) : value)), true);
}

function lpadText(value: RankValue, width: RankValue, fill: RankValue): string {
    if (typeof value !== 'string' || typeof width !== 'bigint'
        || width < 0n || typeof fill !== 'string' || fill.length === 0) {
        throw new RankError('lpad expects text, nonnegative width and nonempty fill', 'TypeError');
    }
    const missing = width - BigInt([...value].length);
    if (missing <= 0n) return value;
    if (missing > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError('lpad width is too large', 'DomainError');
    }
    const chars = [...fill];
    return Array.from({ length: Number(missing) }, (_, index) =>
        chars[index % chars.length]).join('') + value;
}

function lowerText(value: RankValue): string {
    if (typeof value !== 'string') throw new RankError('lower expects text', 'TypeError');
    return value.toLowerCase();
}

function translateText(value: RankValue, chars: RankValue, replacement: RankValue): string {
    if (typeof value !== 'string' || typeof chars !== 'string'
        || typeof replacement !== 'string') {
        throw new RankError('translate expects three text values', 'TypeError');
    }
    const targets = [...replacement];
    const map = new Map<string, string>();
    [...chars].forEach((char, index) => {
        if (!map.has(char)) map.set(char, targets[index] ?? '');
    });
    return [...value].map(char => map.get(char) ?? char).join('');
}

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

function tokenize(value: string): string[] {
    return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function compareCodepoints(left: string, right: string): number {
    const a = [...left];
    const b = [...right];
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!;
        if (difference !== 0) return difference;
    }
    return a.length - b.length;
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
