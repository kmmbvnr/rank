import { Bool, Dictionary, Float64, Int32, Int64, Utf8, Vector, makeData, type DataType } from 'apache-arrow';
import { checkpoint } from './interrupt.js';
import { MissingValueError, RankError } from './errors.js';
import { ownedArray, ownedObject, typedArray } from './array-storage.js';
import { collectionElementType, mergeCollectionElementType, MISSING, type CollectionElementType, type RankArray, type RankObject, type RankRecord, type RankValue } from './value.js';

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

export type RankColumnKind = 'integer' | 'real' | 'boolean' | 'text' | 'values';

/** One column: an Arrow vector, or plain cells where Arrow has no matching type
 * (an integer outside 64 bits, dates, nested values). */
export interface RankArrowColumn {
    readonly name: string;
    readonly kind: RankColumnKind;
    readonly vector?: Vector;
    readonly cells?: readonly (RankValue | undefined)[];
}

/** Columnar table: a schema and one column per field. An immutable value; every
 * change returns a new table that shares the columns it did not touch. An empty
 * CSV cell is a null (an absent field in a row object). */
export class RankArrowTable {
    readonly kind = 'table' as const;
    /** The keys of the `sort by` that produced this table, in row order; `ranknumber` reads them. */
    sortKeys?: readonly (readonly (RankValue | undefined)[])[];

    constructor(readonly length: number, readonly columns: readonly RankArrowColumn[]) {}

    withSortKeys(keys: readonly (readonly (RankValue | undefined)[])[]): RankArrowTable {
        const sorted = new RankArrowTable(this.length, this.columns);
        sorted.sortKeys = keys;
        return sorted;
    }

    get names(): readonly string[] { return this.columns.map(column => column.name); }

    indexOf(name: string): number { return this.columns.findIndex(column => column.name === name); }

    cell(row: number, column: number): RankValue | undefined {
        const source = this.columns[column];
        const value = source.cells !== undefined ? source.cells[row] : source.vector!.get(row);
        return value === null ? undefined : value as RankValue | undefined;
    }

    /** Replace a column, or append it when the name is new. */
    withColumn(column: RankArrowColumn): RankArrowTable {
        if (column.name === '') throw new RankError('table column name must not be empty');
        const index = this.indexOf(column.name);
        const columns = index < 0 ? [...this.columns, column]
            : this.columns.map((existing, position) => position === index ? column : existing);
        return new RankArrowTable(this.length, columns);
    }

    /** Write one cell: only that column is copied. */
    withCell(row: number, name: string, value: RankValue | undefined): RankArrowTable {
        const index = this.indexOf(name);
        if (index < 0) throw new MissingValueError(`missing object key: ${name}`);
        if (row < 0 || row >= this.length) throw new MissingValueError(`table row out of bounds: ${row}`);
        const current = this.columns[index];
        if (value !== undefined && current.kind !== 'values' && current.kind !== columnKindOf(value)
            && !(current.kind === 'real' && typeof value === 'bigint')) {
            throw new RankError(`cannot write ${typeOfCell(value)} into ${current.kind} column ${name}`, 'TypeError');
        }
        const cells = this.cells(index);
        cells[row] = current.kind === 'real' && typeof value === 'bigint' ? Number(value) : value;
        return this.withColumn(columnFromValues(name, cells, current.kind));
    }

    /** All cells of a column, absent ones as undefined. */
    cells(column: number): (RankValue | undefined)[] {
        const cells: (RankValue | undefined)[] = new Array(this.length);
        for (let row = 0; row < this.length; row += 1) cells[row] = this.cell(row, column);
        return cells;
    }

    /** A rank-1 array holding the column. Absent cells raise when read, unless
     * `missing` supplies their replacement. */
    columnArray(name: string, missing?: () => RankValue): RankArray {
        const index = this.indexOf(name);
        if (index < 0) throw new MissingValueError(`missing object key: ${name}`);
        const column = this.columns[index];
        const vector = column.vector;
        if ((column.kind === 'integer' || column.kind === 'real') && vector && vector.nullCount === 0) {
            // Shared with the column: a typed array is never written in place,
            // a write converts it to plain cells first.
            return typedArray(vector.toArray() as Float64Array | BigInt64Array, [this.length]);
        }
        const items: RankValue[] = new Array(this.length);
        let absent = false;
        for (let row = 0; row < this.length; row += 1) {
            const value = this.cell(row, index);
            if (value === undefined) { absent = true; break; }
            items[row] = value;
        }
        if (!absent) return ownedArray(items, [this.length], column.kind !== 'values');
        if (missing !== undefined) {
            for (let row = 0; row < this.length; row += 1) {
                checkpoint('processing table');
                items[row] = this.cell(row, index) ?? missing();
            }
            return ownedArray(items, [this.length]);
        }
        // An absent cell is a cell with no value: `.NA`, kept beside the numbers
        // of a numeric column rather than raised for each read.
        for (let row = 0; row < this.length; row += 1) {
            checkpoint('processing table');
            items[row] = this.cell(row, index) ?? MISSING;
        }
        return ownedArray(items, [this.length]);
    }

    /** Row `row` as a record holding its present cells. */
    row(row: number): RankRecord {
        if (row < 0 || row >= this.length) throw new MissingValueError(`table row out of bounds: ${row}`);
        const entries = new Map<string, RankValue>();
        const types = new Map<string, string>();
        for (let column = 0; column < this.columns.length; column += 1) {
            const value = this.cell(row, column);
            if (value === undefined) continue;
            entries.set(this.columns[column].name, value);
            types.set(this.columns[column].name, typeOfCell(value));
        }
        return { kind: 'record', entries, types };
    }

    /** The rows at these positions, in this order, as a new table. */
    takeRows(rows: ArrayLike<number>): RankArrowTable {
        const columns = this.columns.map((column, position) => {
            checkpoint('processing table');
            const cells: (RankValue | undefined)[] = new Array(rows.length);
            for (let at = 0; at < rows.length; at += 1) cells[at] = this.cell(rows[at], position);
            return columnFromValues(column.name, cells, column.kind);
        });
        return new RankArrowTable(rows.length, columns);
    }

    /** The row-object array Rank uses for irregular data: independent snapshots. */
    toRows(): RankArray {
        const items: RankValue[] = [];
        for (let row = 0; row < this.length; row += 1) {
            checkpoint('processing table');
            const entries = new Map<string, RankValue>();
            for (let column = 0; column < this.columns.length; column += 1) {
                const value = this.cell(row, column);
                if (value !== undefined) entries.set(this.columns[column].name, value);
            }
            items.push(ownedObject(entries));
        }
        return ownedArray(items, [items.length], false, this.names);
    }

    /** A table from object rows. Columns appear in first-seen field order. */
    static fromRows(source: readonly RankValue[], names?: readonly string[]): RankArrowTable {
        const order = new Map<string, number>((names ?? []).map((name, index) => [name, index]));
        const rows: RankObject[] = [];
        for (const item of source) {
            checkpoint('processing table');
            if (typeof item !== 'object' || (item.kind !== 'object' && item.kind !== 'record')) {
                throw new RankError('table expects object rows', 'TypeError');
            }
            rows.push(item as RankObject);
            for (const name of (item as RankObject).entries.keys()) if (!order.has(name)) order.set(name, order.size);
        }
        const columns = [...order.keys()].map(name => {
            checkpoint('processing table');
            return columnFromValues(name, rows.map(row => row.entries.get(name)));
        });
        return new RankArrowTable(rows.length, columns);
    }
}

function typeOfCell(value: RankValue): string {
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return 'real';
    if (typeof value === 'string') return 'text';
    if (typeof value === 'boolean') return 'boolean';
    return value.kind === 'label' ? 'symbol' : value.kind;
}

function columnKindOf(value: RankValue): RankColumnKind {
    if (typeof value === 'bigint') return 'integer';
    if (typeof value === 'number') return 'real';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') return 'text';
    return 'values';
}

/** A column from JS cells (undefined is absent). A column holding one type gets
 * a typed buffer; unsupported types keep their original representation. `hint` names
 * the type of a column with no present cell. */
export function columnFromValues(
    name: string, values: readonly (RankValue | undefined)[], hint?: RankColumnKind,
): RankArrowColumn {
    values = values.map(value => value === MISSING ? undefined : value);
    const rows = values.length;
    let kind: RankColumnKind | undefined;
    let present = 0;
    let schema: CollectionElementType | undefined;
    for (const value of values) {
        if (value === undefined || value === MISSING) continue;
        schema = mergeCollectionElementType(`table column .${name}`, schema, collectionElementType(value, new Set(), true));
        present += 1;
        const next = columnKindOf(value);
        if (kind === undefined) kind = next;
        else if (kind !== next) kind = 'values';
    }
    if (kind === undefined) kind = hint === undefined || hint === 'values' ? 'text' : hint;
    if (kind === 'integer'
        && values.some(value => value !== undefined && ((value as bigint) < INT64_MIN || (value as bigint) > INT64_MAX))) {
        kind = 'values';
    }
    if (kind === 'values') return { name, kind, cells: values };
    const validity = bitmap(rows);
    let nulls = 0;
    if (kind === 'integer') {
        const data = new BigInt64Array(rows);
        for (let row = 0; row < rows; row += 1) {
            const value = values[row];
            if (value === undefined) nulls += 1;
            else { data[row] = value as bigint; setBit(validity, row); }
        }
        return { name, kind, vector: vectorOf(new Int64(), rows, nulls, validity, { data }) };
    }
    if (kind === 'real') {
        const data = new Float64Array(rows);
        for (let row = 0; row < rows; row += 1) {
            const value = values[row];
            if (value === undefined) nulls += 1;
            else { data[row] = value as number; setBit(validity, row); }
        }
        return { name, kind, vector: vectorOf(new Float64(), rows, nulls, validity, { data }) };
    }
    if (kind === 'boolean') {
        const data = bitmap(rows);
        for (let row = 0; row < rows; row += 1) {
            const value = values[row];
            if (value === undefined) nulls += 1;
            else { if (value === true) setBit(data, row); setBit(validity, row); }
        }
        return { name, kind, vector: vectorOf(new Bool(), rows, nulls, validity, { data }) };
    }
    const distinct = new Map<string, number>();
    for (const value of values) {
        if (value === undefined) continue;
        if (!distinct.has(value as string)) distinct.set(value as string, distinct.size);
        if (distinct.size > DICTIONARY_LIMIT) break;
    }
    const writer = textWriter(name, rows, present, distinct.size > DICTIONARY_LIMIT ? undefined : distinct);
    for (let row = 0; row < rows; row += 1) writer.write(row, values[row] as string | undefined);
    return writer.finish();
}

const COMMA = 44, QUOTE = 34, LF = 10, CR = 13;

/** Calls `visit` once per CSV record with a reused field array. Only the record
 * being read is alive, so no row of the file is retained. Quoting rules and
 * messages are those of the row reader. */
function scanRecords(text: string, visit: (fields: string[], count: number) => void): void {
    const fields: string[] = [];
    const length = text.length;
    let position = 0;
    while (position < length) {
        let count = 0;
        for (;;) {
            checkpoint('processing table');
            let value: string;
            if (text.charCodeAt(position) === QUOTE) {
                value = '';
                let start = position + 1;
                for (;;) {
                    const close = text.indexOf('"', start);
                    if (close < 0) throw new RankError('unterminated quoted CSV field');
                    value += text.slice(start, close);
                    if (text.charCodeAt(close + 1) === QUOTE) {
                        value += '"';
                        start = close + 2;
                        continue;
                    }
                    position = close + 1;
                    break;
                }
                const next = text.charCodeAt(position);
                if (position < length && next !== COMMA && next !== LF && next !== CR) {
                    throw new RankError('unexpected character after quoted CSV field');
                }
            } else {
                let end = position;
                while (end < length) {
                    const code = text.charCodeAt(end);
                    if (code === COMMA || code === LF || code === CR) break;
                    if (code === QUOTE) throw new RankError('unexpected quote in CSV field');
                    end += 1;
                }
                value = text.slice(position, end);
                position = end;
            }
            fields[count++] = value;
            if (position >= length) break;
            if (text.charCodeAt(position) === COMMA) {
                position += 1;
                continue;
            }
            position += text.charCodeAt(position) === CR && text.charCodeAt(position + 1) === LF ? 2 : 1;
            break;
        }
        visit(fields, count);
    }
}

const CSV_INTEGER = /^[+-]?(?:0|[1-9]\d*)$/;
const CSV_REAL = /^[+-]?(?:(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)$/;

/** What the first pass learns about a column. */
interface Shape {
    present: number;
    integer: boolean;
    real: boolean;
    boolean: boolean;
    wide: boolean;
    infinite?: { row: number; text: string };
    /** Distinct text in first-seen order; dropped when it cannot be complete or is too big. */
    distinct?: Map<string, number>;
    untracked: boolean;
}

/** Repeated text is stored once per distinct value when it repeats enough. */
const DICTIONARY_RATIO = 4;
const DICTIONARY_LIMIT = 1 << 16;

/** Reads CSV in two passes over the text. The first learns the row count and
 * each column's type, keeping nothing per row; the second writes values straight
 * into Arrow buffers. No array of row strings exists at any point. */
export function parseCsvToArrow(text: string): RankArrowTable {
    let headers: string[] | undefined;
    let shapes: Shape[] = [];
    let rows = 0;
    let badRow: { row: number; count: number } | undefined;
    let record = 0;
    scanRecords(text, (fields, count) => {
        record += 1;
        if (headers === undefined) {
            headers = fields.slice(0, count).map((header, index) => index === 0
                ? header.replace(/^﻿/, '') : header);
            shapes = headers.map(() => ({
                present: 0, integer: true, real: true, boolean: true, wide: false, distinct: new Map(), untracked: false,
            }));
            return;
        }
        rows += 1;
        if (count !== headers.length) {
            badRow ??= { row: record, count };
            return;
        }
        if (badRow !== undefined) return;
        for (let column = 0; column < count; column += 1) {
            const value = fields[column];
            if (value !== '') learn(shapes[column], value, rows);
        }
    });
    if (headers === undefined) throw new RankError('CSV input must contain a header row');
    const seen = new Set<string>();
    for (const header of headers) {
        checkpoint('processing table');
        if (header.length === 0) throw new RankError('CSV header must not be empty');
        if (seen.has(header)) throw new RankError(`duplicate CSV header: ${header}`);
        seen.add(header);
    }
    const kinds = shapes.map(kindOf);
    // The row reader converts a row after checking its width, so whichever
    // problem sits on the earlier row is the one it reports.
    const overflow = shapes.map((shape, column) => kinds[column] === 'real' ? shape.infinite : undefined)
        .filter(item => item !== undefined).sort((a, b) => a.row - b.row)[0];
    if (badRow !== undefined && (overflow === undefined || badRow.row - 1 <= overflow.row)) {
        throw new RankError(
            `CSV row ${badRow.row} has ${badRow.count} ${badRow.count === 1 ? 'field' : 'fields'}, expected ${headers.length}`,
        );
    }
    if (overflow !== undefined) {
        throw new RankError(`CSV number is outside supported range: ${overflow.text}`);
    }

    const writers = headers.map((name, column) => columnWriter(name, kinds[column], shapes[column], rows));
    let row = 0;
    let first = true;
    scanRecords(text, fields => {
        if (first) {
            first = false;
            return;
        }
        for (let column = 0; column < writers.length; column += 1) writers[column].write(row, fields[column]);
        row += 1;
    });
    return new RankArrowTable(rows, writers.map(writer => writer.finish()));
}

// Kaggle and pandas write Python-style True/False.
function isCsvBoolean(value: string): boolean {
    return value === 'true' || value === 'false' || value === 'True' || value === 'False';
}

function learn(shape: Shape, value: string, row: number): void {
    shape.present += 1;
    if (shape.integer || shape.real || shape.boolean) {
        const isInteger = CSV_INTEGER.test(value);
        if (!isInteger) shape.integer = false;
        if (shape.real && !isInteger && !CSV_REAL.test(value)) shape.real = false;
        if (shape.boolean && !isCsvBoolean(value)) shape.boolean = false;
        if (isInteger && !shape.wide && value.length >= 19) {
            const number = BigInt(value);
            if (number < INT64_MIN || number > INT64_MAX) shape.wide = true;
        }
        if (shape.real && !isInteger && shape.infinite === undefined
            && (value.length > 300 || value.includes('e') || value.includes('E'))
            && !Number.isFinite(Number(value))) {
            shape.infinite = { row, text: value };
        }
    }
    if (shape.integer || shape.real || shape.boolean) {
        // Read as a number so far; earlier cells were not counted as text.
        shape.untracked = true;
        return;
    }
    const distinct = shape.distinct;
    if (distinct === undefined) return;
    if (shape.untracked) {
        shape.distinct = undefined;
        return;
    }
    if (!distinct.has(value)) {
        distinct.set(value, distinct.size);
        if (distinct.size > DICTIONARY_LIMIT) shape.distinct = undefined;
    }
}

function kindOf(shape: Shape): RankColumnKind {
    if (shape.present > 0 && shape.integer) return 'integer';
    if (shape.present > 0 && shape.real) return 'real';
    if (shape.present > 0 && shape.boolean) return 'boolean';
    return 'text';
}

interface ColumnWriter {
    write(row: number, value: string): void;
    finish(): RankArrowColumn;
}

function bitmap(rows: number): Uint8Array { return new Uint8Array((rows + 7) >> 3); }
function setBit(bits: Uint8Array, index: number): void { bits[index >> 3] |= 1 << (index & 7); }

function vectorOf(type: DataType, rows: number, nulls: number, validity: Uint8Array, fields: object): Vector {
    return new Vector([makeData({
        type, length: rows, nullCount: nulls, ...(nulls === 0 ? {} : { nullBitmap: validity }), ...fields,
    } as never)]);
}

function columnWriter(name: string, kind: RankColumnKind, shape: Shape, rows: number): ColumnWriter {
    const validity = bitmap(rows);
    let nulls = 0;
    if (kind === 'integer' && shape.wide) {
        const cells: (bigint | undefined)[] = new Array(rows);
        return {
            write: (row, value) => { cells[row] = value === '' ? undefined : BigInt(value); },
            finish: () => ({ name: name, kind: 'values', cells }),
        };
    }
    if (kind === 'integer') {
        const data = new BigInt64Array(rows);
        return {
            write(row, value) {
                if (value === '') nulls += 1;
                else { data[row] = BigInt(value); setBit(validity, row); }
            },
            finish: () => ({ name, kind, vector: vectorOf(new Int64(), rows, nulls, validity, { data }) }),
        };
    }
    if (kind === 'real') {
        const data = new Float64Array(rows);
        return {
            write(row, value) {
                if (value === '') nulls += 1;
                else { data[row] = Number(value); setBit(validity, row); }
            },
            finish: () => ({ name, kind, vector: vectorOf(new Float64(), rows, nulls, validity, { data }) }),
        };
    }
    if (kind === 'boolean') {
        const data = bitmap(rows);
        return {
            write(row, value) {
                if (value === '') nulls += 1;
                else { if (value === 'true' || value === 'True') setBit(data, row); setBit(validity, row); }
            },
            finish: () => ({ name, kind, vector: vectorOf(new Bool(), rows, nulls, validity, { data }) }),
        };
    }
    const text = textWriter(name, rows, shape.present, shape.distinct);
    return { write: (row, value) => text.write(row, value === '' ? undefined : value), finish: text.finish };
}

/** Text: a dictionary when the distinct values are known and repeat enough,
 * otherwise offsets into one UTF-8 byte buffer. An empty string is absent. */
function textWriter(
    name: string, rows: number, present: number, distinct: Map<string, number> | undefined,
): { write(row: number, value: string | undefined): void; finish(): RankArrowColumn } {
    const validity = bitmap(rows);
    let nulls = 0;
    if (distinct !== undefined && distinct.size > 0 && distinct.size * DICTIONARY_RATIO <= present) {
        const codes = new Int32Array(rows);
        return {
            write(row, value) {
                if (value === undefined) nulls += 1;
                else { codes[row] = distinct.get(value)!; setBit(validity, row); }
            },
            finish() {
                const type = new Dictionary(new Utf8(), new Int32());
                const dictionary = new Vector([utf8Data([...distinct.keys()])]);
                return { name, kind: 'text', vector: vectorOf(type, rows, nulls, validity, { data: codes, dictionary }) };
            },
        };
    }
    const encoder = new TextEncoder();
    const offsets = new Int32Array(rows + 1);
    let bytes = new Uint8Array(Math.max(1024, present * 8));
    let used = 0;
    return {
        write(row, value) {
            if (value === undefined) nulls += 1;
            else {
                setBit(validity, row);
                // Worst case is three bytes per UTF-16 unit.
                if (used + value.length * 3 > bytes.length) {
                    const grown = new Uint8Array(Math.max(bytes.length * 2, used + value.length * 3));
                    grown.set(bytes.subarray(0, used));
                    bytes = grown;
                }
                used += encoder.encodeInto(value, bytes.subarray(used)).written;
            }
            offsets[row + 1] = used;
        },
        finish: () => ({ name, kind: 'text', vector: vectorOf(new Utf8(), rows, nulls, validity, {
            valueOffsets: offsets, data: bytes.slice(0, used),
        }) }),
    };
}

function utf8Data(values: readonly string[]) {
    const encoder = new TextEncoder();
    const encoded = values.map(value => encoder.encode(value));
    const offsets = new Int32Array(values.length + 1);
    encoded.forEach((bytes, index) => { offsets[index + 1] = offsets[index] + bytes.length; });
    const data = new Uint8Array(offsets[values.length]);
    encoded.forEach((bytes, index) => data.set(bytes, offsets[index]));
    return makeData({ type: new Utf8(), length: values.length, nullCount: 0, valueOffsets: offsets, data });
}
