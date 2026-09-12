import { derivedArray, ownedArray, ownedObject } from '../array-storage.js';
import { MissingValueError, RankError } from '../errors.js';
import { readTextFile, writeTextFile } from './io.js';
import { materializeSqlite, selectSqlite } from './sqlite.js';
import {
    formatDate,
    isRankObject,
    isRankArray,
    isRankDate,
    isRankLabel,
    isRankSqliteTable,
    isRankSqliteExpression,
    isRankTableAlias,
    isRankRecord,
    type RankGroupedColumn,
    type RankGroupedTable,
    type RankArray,
    type RankObject,
    type RankRecord,
    type RankValue,
} from '../value.js';
import { setValueKey } from '../set.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const tablesModule: RuntimeModule = {
    select: () => native('select', 2, ([input, fields]) => {
        if (!isRankRecord(fields)) throw new RankError('select expects a record of columns', 'TypeError');
        const source = isRankTableAlias(input) ? input.source : input;
        if (isRankSqliteTable(source)) return selectSqlite(source, fields);
        if (isRankArray(source)) return selectArray(source, fields);
        throw new RankError('select expects a rank-1 table or SQLite view', 'TypeError');
    }),
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
        return ownedArray(items);
    }),
    csv: context => native('csv', [1, 2], arguments_ => {
        if (arguments_.length === 1) {
            return parseCsv(readTextFile(context.io, arguments_[0]));
        }
        const path = arguments_[1];
        if (typeof path !== 'string') throw new RankError('file path must be text');
        const source = isRankTableAlias(arguments_[0]) ? arguments_[0].source : arguments_[0];
        const value = isRankSqliteTable(source) ? materializeSqlite(source) : source;
        writeTextFile(context.io, path, formatCsv(value));
        return arguments_[0];
    }),
};

function selectArray(source: RankArray, fields: RankRecord): RankArray {
    if (source.shape.length !== 1) {
        throw new RankError('select expects a rank-1 table', 'DimensionMismatch');
    }
    if (fields.entries.size === 0) throw new RankError('select requires at least one field', 'TypeError');
    const entries = [...fields.entries];
    const dependencies = [source];
    for (const [name, value] of entries) {
        if (isRankSqliteExpression(value)) {
            throw new RankError(`select field .${name} belongs to a SQLite view`, 'TypeError');
        }
        if (!isRankArray(value)) continue;
        if (value.shape.length !== 1 || value.shape[0] !== source.shape[0]) {
            throw new RankError(`select field .${name} must have one value per row`, 'DimensionMismatch');
        }
        dependencies.push(value);
    }
    const result = derivedArray(source.shape, dependencies, position => {
        const row = source.itemAt?.(position) ?? source.items[position];
        if (!isRankObject(row)) throw new RankError('select expects object rows', 'TypeError');
        const selected = new Map<string, RankValue>();
        for (const [name, column] of entries) {
            try {
                selected.set(name, isRankArray(column)
                    ? column.itemAt?.(position) ?? column.items[position] : column);
            } catch (error) {
                if (!(error instanceof MissingValueError)) throw error;
            }
        }
        return ownedObject(selected);
    });
    Object.defineProperty(result, 'columnNames', { value: entries.map(([name]) => name) });
    return result;
}

function tableRows(value: RankValue, operation: string): RankObject[] {
    if (!isRankArray(value) || value.shape.length !== 1) {
        throw new RankError(`${operation} expects a rank-1 table`, 'DimensionMismatch');
    }
    const rows = Array.from({ length: value.shape[0] }, (_, index) =>
        value.itemAt?.(index) ?? value.items[index]);
    if (!rows.every(isRankObject)) {
        throw new RankError(`${operation} expects object rows`, 'TypeError');
    }
    return rows;
}

function tableColumns(value: RankArray, rows: readonly RankObject[]): string[] {
    const names = new Set(value.columnNames ?? []);
    for (const row of rows) for (const name of row.entries.keys()) names.add(name);
    return [...names];
}

function tableKey(
    row: RankObject,
    fields: readonly string[],
    keepMissing = false,
): string | undefined {
    const parts: (string | null)[] = [];
    for (const field of fields) {
        const value = row.entries.get(field);
        if (value === undefined) {
            if (!keepMissing) return undefined;
            parts.push(null);
            continue;
        }
        if (!(typeof value === 'bigint' || typeof value === 'number'
            || typeof value === 'boolean' || typeof value === 'string'
            || isRankLabel(value) || isRankDate(value))) {
            throw new RankError(`table key .${field} must be scalar`, 'TypeError');
        }
        if (typeof value === 'number' && Number.isNaN(value)) {
            throw new RankError(`table key .${field} cannot be NaN`, 'DomainError');
        }
        parts.push(setValueKey(value));
    }
    return JSON.stringify(parts);
}

export function groupTable(source: RankValue, fields: readonly string[]): RankGroupedTable {
    const rows = tableRows(source, 'group by');
    if (new Set(fields).size !== fields.length) {
        throw new RankError('group by fields must be unique', 'TypeError');
    }
    const groups: { keys: (RankValue | undefined)[]; rows: RankObject[] }[] = [];
    const positions = new Map<string, number>();
    for (const sourceRow of rows) {
        const row = ownedObject(sourceRow.entries);
        const keys = fields.map(field => row.entries.get(field));
        const id = tableKey(row, fields, true)!;
        let position = positions.get(id);
        if (position === undefined) {
            position = groups.length;
            positions.set(id, position);
            groups.push({ keys, rows: [] });
        }
        groups[position].rows.push(row);
    }
    return { kind: 'grouped-table', fields, groups };
}

export function aggregateGroupedColumn(
    column: RankGroupedColumn,
    reduce: (values: RankArray) => RankValue,
    emptyIsMissing = false,
): RankArray {
    const { table, field } = column;
    if (table.fields.includes(field)) {
        throw new RankError(`grouped aggregate field .${field} is also a key`, 'TypeError');
    }
    const items: RankValue[] = table.groups.map(group => {
        const entries = new Map<string, RankValue>();
        table.fields.forEach((name, index) => {
            const key = group.keys[index];
            if (key !== undefined) entries.set(name, key);
        });
        const values = group.rows.flatMap(row => {
            const value = row.entries.get(field);
            return value === undefined ? [] : [value];
        });
        if (values.length > 0 || !emptyIsMissing) {
            entries.set(field, reduce(ownedArray(values)));
        }
        return ownedObject(entries);
    });
    return ownedArray(items, [items.length], false, [...table.fields, field]);
}

export function joinTables(
    left: RankValue,
    right: RankValue,
    leftFields: readonly string[],
    mode: 'leftjoin' | 'innerjoin',
    rightFields: readonly string[] = leftFields,
): RankArray {
    if (leftFields.length !== rightFields.length
        || new Set(leftFields).size !== leftFields.length
        || new Set(rightFields).size !== rightFields.length) {
        throw new RankError(`${mode} key fields must be distinct and aligned`, 'TypeError');
    }
    const leftRows = tableRows(left, mode);
    const rightRows = tableRows(right, mode);
    const leftNames = tableColumns(left as RankArray, leftRows);
    const rightNames = tableColumns(right as RankArray, rightRows);
    for (const field of leftFields) {
        if (!leftNames.includes(field)) throw new MissingValueError(`${mode} left key .${field} is missing`);
    }
    for (const field of rightFields) {
        if (!rightNames.includes(field)) throw new MissingValueError(`${mode} right key .${field} is missing`);
    }
    const rightValues = rightNames.filter(name => !rightFields.includes(name));
    for (const name of rightValues) {
        if (leftNames.includes(name)) {
            throw new RankError(`${mode} has duplicate non-key column .${name}`, 'TypeError');
        }
    }
    const matches = new Map<string, RankObject[]>();
    for (const row of rightRows) {
        const key = tableKey(row, rightFields);
        if (key === undefined) continue;
        const bucket = matches.get(key) ?? [];
        bucket.push(row);
        matches.set(key, bucket);
    }
    const items: RankValue[] = [];
    for (const row of leftRows) {
        const key = tableKey(row, leftFields);
        const hits = key === undefined ? undefined : matches.get(key);
        if (hits === undefined) {
            if (mode === 'leftjoin') items.push(ownedObject(row.entries));
            continue;
        }
        for (const hit of hits) {
            const entries = new Map(row.entries);
            for (const [name, value] of hit.entries) {
                if (!rightFields.includes(name)) entries.set(name, value);
            }
            items.push(ownedObject(entries));
        }
    }
    return ownedArray(items, [items.length], false, [...leftNames, ...rightValues]);
}

export function joinAliasedTables(
    left: RankArray, right: RankArray, leftName: string, rightName: string,
    leftFields: readonly string[], rightFields: readonly string[], mode: 'leftjoin' | 'innerjoin',
): RankArray {
    if (leftName === rightName) throw new RankError(`${mode} aliases must differ`, 'TypeError');
    if (leftFields.length !== rightFields.length
        || new Set(leftFields).size !== leftFields.length
        || new Set(rightFields).size !== rightFields.length) {
        throw new RankError(`${mode} key fields must be distinct and aligned`, 'TypeError');
    }
    const leftRows = tableRows(left, mode);
    const rightRows = tableRows(right, mode);
    const leftNames = tableColumns(left, leftRows);
    const rightNames = tableColumns(right, rightRows);
    for (const field of leftFields) {
        if (!leftNames.includes(field)) throw new MissingValueError(`${mode} left key .${field} is missing`);
    }
    for (const field of rightFields) {
        if (!rightNames.includes(field)) throw new MissingValueError(`${mode} right key .${field} is missing`);
    }
    const matches = new Map<string, RankObject[]>();
    for (const row of rightRows) {
        const key = tableKey(row, rightFields);
        if (key === undefined) continue;
        const bucket = matches.get(key) ?? [];
        bucket.push(row);
        matches.set(key, bucket);
    }
    const items: RankValue[] = [];
    for (const row of leftRows) {
        const key = tableKey(row, leftFields);
        const hits = key === undefined ? undefined : matches.get(key);
        if (!hits) {
            if (mode === 'leftjoin') {
                items.push(ownedObject(new Map([[leftName, ownedObject(row.entries)]])));
            }
            continue;
        }
        for (const hit of hits) {
            items.push(ownedObject(new Map([
                [leftName, ownedObject(row.entries)],
                [rightName, ownedObject(hit.entries)],
            ])));
        }
    }
    const result = ownedArray(items, [items.length], false, [leftName, rightName]);
    Object.defineProperty(result, 'tableScopes', { value: [leftName, rightName] });
    return result;
}

export function projectAliasedField(
    source: RankArray, scope: string, field: string, missing?: () => RankValue,
): RankArray {
    const itemAt = (position: number): RankValue => {
        const row = source.itemAt?.(position) ?? source.items[position];
        if (!isRankObject(row)) throw new RankError('table projection expects object rows', 'TypeError');
        const nested = row.entries.get(scope);
        if (nested === undefined) {
            if (missing) return missing();
            throw new MissingValueError(`missing object key: ${scope}`);
        }
        if (!isRankObject(nested)) throw new RankError('table projection expects object rows', 'TypeError');
        const value = nested.entries.get(field);
        if (value === undefined) {
            if (missing) return missing();
            throw new MissingValueError(`missing object key: ${field}`);
        }
        return value;
    };
    return derivedArray(source.shape, [source], itemAt, true);
}

/** Lazily project one named field from every object cell in an array. */
export function projectField(
    source: RankArray,
    field: string,
    missing?: () => RankValue,
): RankArray {
    const itemAt = (position: number): RankValue => {
        const row = source.itemAt?.(position) ?? source.items[position];
        if (!isRankObject(row)) {
            throw new RankError('table projection expects object rows', 'TypeError');
        }
        const value = row.entries.get(field);
        if (value === undefined) {
            if (missing) return missing();
            throw new MissingValueError(`missing object key: ${field}`);
        }
        return value;
    };
    return derivedArray(source.shape, [source], itemAt, true);
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
    const itemAt = (position: number): RankValue => {
        const rowIndex = Math.floor(position / columns);
        const row = source.itemAt?.(rowIndex) ?? source.items[rowIndex];
        if (!isRankObject(row)) {
            throw new RankError('table projection expects object rows', 'TypeError');
        }
        const field = names[position % columns];
        const value = row.entries.get(field);
        if (value === undefined) throw new MissingValueError(`missing object key: ${field}`);
        return value;
    };
    const result = derivedArray([source.shape[0], columns], [source], itemAt, true);
    Object.defineProperty(result, 'columnNames', { value: names });
    return result;
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
        items.push(ownedObject(entries));
    }
    return ownedArray(items, [items.length], false, headers);
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
    if (value.items.length === 0 && value.columnNames !== undefined) {
        return `${value.columnNames.map(csvField).join(',')}\n`;
    }
    if (value.items.length === 0) throw new RankError('csv output requires at least one row');
    const first = objectRow(value.items[0]);
    const headers = value.columnNames ?? [...first.entries.keys()];
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
    if (isRankDate(value)) return formatDate(value);
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
