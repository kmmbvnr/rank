import { MissingValueError, RankError } from '../errors.js';
import { readTextFile, writeTextFile } from './io.js';
import {
    isRankObject,
    isRankArray,
    isRankLabel,
    type RankArray,
    type RankObject,
    type RankValue,
} from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const tablesModule: RuntimeModule = {
    labels: () => native('labels', 1, ([value]) => {
        if (!isRankArray(value) || value.shape.length !== 1) {
            throw new RankError('labels expects a rank-1 table', 'DimensionMismatch');
        }
        const names = value.columnNames === undefined ? new Set<string>() : new Set(value.columnNames);
        for (const item of value.items) {
            if (!isRankObject(item)) throw new RankError('labels expects object rows', 'TypeError');
            for (const name of item.entries.keys()) names.add(name);
        }
        const items: RankValue[] = [...names].map(name => ({ kind: 'label', name }));
        return { kind: 'array', items, shape: [items.length] };
    }),
    csv: context => native('csv', [1, 2], arguments_ => {
        if (arguments_.length === 1) {
            return parseCsv(readTextFile(context.io, arguments_[0]));
        }
        const path = arguments_[1];
        if (typeof path !== 'string') throw new RankError('file path must be text');
        writeTextFile(context.io, path, formatCsv(arguments_[0]));
        return arguments_[0];
    }),
};

/** Lazily project one named field from every object cell in an array. */
export function projectField(
    source: RankArray,
    field: string,
    missing?: () => RankValue,
): RankArray {
    const cache = new Map<number, RankValue>();
    const itemAt = (position: number): RankValue => {
        const cached = cache.get(position);
        if (cached !== undefined) return cached;
        const row = source.itemAt?.(position) ?? source.items[position];
        if (!isRankObject(row)) {
            throw new RankError('table projection expects object rows', 'TypeError');
        }
        const value = row.entries.get(field);
        if (value === undefined) {
            if (missing) return missing();
            throw new MissingValueError(`missing object key: ${field}`);
        }
        cache.set(position, value);
        return value;
    };
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape: source.shape,
        itemAt,
        containsFiles: false,
        get items() {
            const size = source.shape.reduce(
                (product, dimension) => product * dimension,
                1,
            );
            materialized ??= Array.from(
                { length: size },
                (_, position) => itemAt(position),
            );
            return materialized;
        },
    };
}

/** Lazily project an ordered list of fields into a rows-by-fields matrix. */
export function projectFields(source: RankArray, fields: RankArray): RankArray {
    if (source.shape.length !== 1) {
        throw new RankError('table column selection expects a rank-1 table', 'DimensionMismatch');
    }
    if (fields.shape.length !== 1) {
        throw new RankError('table column selection expects a rank-1 field list', 'DimensionMismatch');
    }
    const names = fields.items.map(field => {
        if (typeof field === 'string') return field;
        if (isRankLabel(field)) return field.name;
        throw new RankError('table column selection expects labels or text', 'TypeError');
    });
    const columns = names.length;
    const cache = new Map<number, RankValue>();
    const itemAt = (position: number): RankValue => {
        const cached = cache.get(position);
        if (cached !== undefined) return cached;
        const rowIndex = Math.floor(position / columns);
        const row = source.itemAt?.(rowIndex) ?? source.items[rowIndex];
        if (!isRankObject(row)) {
            throw new RankError('table projection expects object rows', 'TypeError');
        }
        const field = names[position % columns];
        const value = row.entries.get(field);
        if (value === undefined) throw new MissingValueError(`missing object key: ${field}`);
        cache.set(position, value);
        return value;
    };
    let materialized: RankValue[] | undefined;
    return {
        kind: 'array',
        shape: [source.shape[0], columns],
        columnNames: names,
        itemAt,
        containsFiles: false,
        get items() {
            const size = source.shape[0] * columns;
            materialized ??= Array.from({ length: size }, (_, position) => itemAt(position));
            return materialized;
        },
    };
}

function parseCsv(text: string): RankArray {
    const rows = csvRows(text);
    if (rows.length === 0) throw new RankError('CSV input must contain a header row');
    const headers = rows[0].map((header, index) => index === 0
        ? header.replace(/^\uFEFF/, '') : header);
    const seen = new Set<string>();
    for (const header of headers) {
        if (header.length === 0) throw new RankError('CSV header must not be empty');
        if (seen.has(header)) throw new RankError(`duplicate CSV header: ${header}`);
        seen.add(header);
    }

    const data = rows.slice(1);
    const columnKinds = headers.map((_, column) => csvColumnKind(
        data.map(row => row[column]).filter(value => value !== undefined && value !== ''),
    ));
    const items: RankValue[] = [];
    for (let index = 0; index < data.length; index += 1) {
        const fields = data[index];
        if (fields.length !== headers.length) {
            throw new RankError(
                `CSV row ${index + 2} has ${fields.length} ${fields.length === 1 ? 'field' : 'fields'}, expected ${headers.length}`,
            );
        }
        const entries = new Map<string, RankValue>();
        for (let column = 0; column < headers.length; column += 1) {
            if (fields[column] !== '') {
                entries.set(headers[column], csvValue(fields[column], columnKinds[column]));
            }
        }
        items.push({ kind: 'object', entries });
    }
    return { kind: 'array', items, shape: [items.length], columnNames: headers, containsFiles: false };
}

function csvRows(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    let afterQuote = false;
    let started = false;

    const finishField = () => {
        row.push(field);
        field = '';
        afterQuote = false;
        started = false;
    };
    const finishRow = () => {
        finishField();
        rows.push(row);
        row = [];
    };

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (character === '"') {
                if (text[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else {
                    quoted = false;
                    afterQuote = true;
                }
            } else {
                field += character;
            }
            continue;
        }
        if (afterQuote && character !== ',' && character !== '\n' && character !== '\r') {
            throw new RankError('unexpected character after quoted CSV field');
        }
        if (character === '"') {
            if (started || field.length > 0) throw new RankError('unexpected quote in CSV field');
            quoted = true;
            started = true;
        } else if (character === ',') {
            finishField();
        } else if (character === '\n' || character === '\r') {
            if (character === '\r' && text[index + 1] === '\n') index += 1;
            finishRow();
        } else {
            field += character;
            started = true;
        }
    }
    if (quoted) throw new RankError('unterminated quoted CSV field');
    if (started || afterQuote || field.length > 0 || row.length > 0) finishRow();
    return rows;
}

type CsvColumnKind = 'integer' | 'real' | 'boolean' | 'text';

const CSV_INTEGER = /^[+-]?(?:0|[1-9]\d*)$/;
const CSV_REAL = /^[+-]?(?:(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)$/;

function csvColumnKind(values: readonly string[]): CsvColumnKind {
    if (values.length > 0 && values.every(value => CSV_INTEGER.test(value))) return 'integer';
    if (values.length > 0 && values.every(value => CSV_INTEGER.test(value) || CSV_REAL.test(value))) return 'real';
    if (values.length > 0 && values.every(value => value === 'true' || value === 'false')) return 'boolean';
    return 'text';
}

function csvValue(value: string, kind: CsvColumnKind): RankValue {
    if (kind === 'integer') return BigInt(value);
    if (kind === 'real') {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new RankError(`CSV number is outside supported range: ${value}`);
        return number;
    }
    if (kind === 'boolean') return value === 'true';
    return value;
}

function formatCsv(value: RankValue): string {
    if (isRankArray(value) && value.shape.length === 2 && value.columnNames !== undefined) {
        return formatSelectedColumns(value);
    }
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError('csv output expects a table or selected table columns');
    }
    if (value.items.length === 0) throw new RankError('csv output requires at least one row');
    const first = objectRow(value.items[0]);
    const headers = [...first.entries.keys()];
    if (headers.length === 0) throw new RankError('csv output requires at least one column');
    const known = new Set(headers);
    const lines = [headers.map(csvField).join(',')];
    for (const item of value.items) {
        const row = objectRow(item);
        for (const field of row.entries.keys()) {
            if (!known.has(field)) throw new RankError(`csv output row has unexpected field: ${field}`);
        }
        lines.push(headers.map(header => {
            const cell = row.entries.get(header);
            return cell === undefined ? '' : csvScalar(cell);
        }).join(','));
    }
    return `${lines.join('\n')}\n`;
}

function formatSelectedColumns(value: RankArray): string {
    const headers = value.columnNames!;
    if (headers.length !== value.shape[1]) {
        throw new RankError('selected table column schema does not match its shape');
    }
    if (headers.length === 0) throw new RankError('csv output requires at least one column');
    if (new Set(headers).size !== headers.length) {
        throw new RankError('csv output columns must have unique names');
    }
    const lines = [headers.map(csvField).join(',')];
    for (let row = 0; row < value.shape[0]; row += 1) {
        lines.push(headers.map((_, column) =>
            csvScalar(value.itemAt?.(row * headers.length + column)
                ?? value.items[row * headers.length + column])).join(','));
    }
    return `${lines.join('\n')}\n`;
}

function objectRow(value: RankValue): RankObject {
    if (!isRankObject(value)) throw new RankError('csv output expects object rows');
    return value;
}

function csvScalar(value: RankValue): string {
    if (typeof value === 'string') return csvField(value);
    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new RankError('csv output numbers must be finite');
    }
    if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    throw new RankError('csv output cells must be scalar values');
}

function csvField(value: string): string {
    return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
