import { RankArrowTable, columnFromValues } from './arrow-table.js';
import { readArrayItem, ownedArray, typedArray } from './array-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { materializeSequence } from './sequence.js';
import { sameShape } from './tensor-index.js';
import {
    isRankArray, isRankLabel, isRankSequence,
    type RankArray, type RankValue,
} from './value.js';

/** How a table is addressed: `Data .Age` (a column), `Data 5` (a row snapshot),
 * `Data Mask` or `Data (0 till 4)` (rows into a new table), `Data (array .a .b)`
 * (columns into a matrix), and those chained: `Data 5 .Age`. */
export function canApplyTable(values: readonly RankValue[]): boolean {
    if (values.length < 2) return false;
    return isTableSelector(values[1]);
}

function isTableSelector(value: RankValue): boolean {
    if (typeof value === 'string' || typeof value === 'bigint' || isRankLabel(value)) return true;
    if (isRankSequence(value)) return true;
    if (!isRankArray(value) || value.shape.length !== 1) return false;
    return value.items.length === 0 || value.items.every(item => typeof item === 'boolean')
        || value.items.every(item => typeof item === 'bigint')
        || value.items.some(item => typeof item === 'string' || isRankLabel(item));
}

function fieldName(value: RankValue): string | undefined {
    if (typeof value === 'string') return value;
    return isRankLabel(value) ? value.name : undefined;
}

export function applyTable(
    table: RankArrowTable, values: readonly RankValue[], missing?: () => RankValue,
    apply?: (values: RankValue[]) => RankValue,
): RankValue {
    const selector = values[1];
    const name = fieldName(selector);
    let selected: RankValue;
    if (name !== undefined) selected = table.columnArray(name, missing);
    else if (typeof selector === 'bigint') {
        if (selector < 0n || selector >= BigInt(table.length)) {
            throw new MissingValueError(`table row out of bounds: ${selector}`);
        }
        selected = table.row(Number(selector));
    } else if (isRankSequence(selector)) selected = selectRows(table, materializeSequence(selector));
    else if (isRankArray(selector)) selected = selectRows(table, selector);
    else throw new RankError('table addressing expects a column, a row number, a mask or columns', 'TypeError');
    if (values.length === 2) return selected;
    if (apply === undefined) throw new RankError('table addressing expects one selector', 'TypeError');
    return apply([selected, ...values.slice(2)]);
}

function selectRows(table: RankArrowTable, selector: RankArray): RankValue {
    if (selector.shape.length !== 1) {
        throw new RankError('table selection expects a rank-1 selector', 'DimensionMismatch');
    }
    const items = Array.from({ length: selector.shape[0] }, (_, index) => readArrayItem(selector, index));
    if (items.some(item => typeof item === 'string' || isRankLabel(item))) return projectColumns(table, items);
    if (items.length > 0 && items.every(item => typeof item === 'boolean')) {
        if (!sameShape(selector.shape, [table.length])) {
            throw new RankError(`mask shape mismatch: ${table.length} and ${selector.shape}`, 'DimensionMismatch');
        }
        const rows: number[] = [];
        for (let row = 0; row < items.length; row += 1) if (items[row] === true) rows.push(row);
        return table.takeRows(rows);
    }
    if (items.every(item => typeof item === 'bigint')) {
        return table.takeRows(items.map(item => {
            const row = item as bigint;
            if (row < 0n || row >= BigInt(table.length)) throw new MissingValueError(`table row out of bounds: ${row}`);
            return Number(row);
        }));
    }
    if (items.length === 0) return table.takeRows([]);
    throw new RankError('table selection expects a boolean mask, row numbers or column names', 'TypeError');
}

/** Integer columns, or real columns, without a gap copy straight into one
 * buffer, row by row: no boxed cell is made. Anything else takes the cell path. */
function typedMatrix(table: RankArrowTable, indices: readonly number[]): Float64Array | BigInt64Array | undefined {
    if (indices.length === 0) return undefined;
    const kind = table.columns[indices[0]].kind;
    if (kind !== 'integer' && kind !== 'real') return undefined;
    const sources: (Float64Array | BigInt64Array)[] = [];
    for (const index of indices) {
        const column = table.columns[index];
        if (column.kind !== kind || !column.vector || column.vector.nullCount !== 0) return undefined;
        sources.push(column.vector.toArray() as Float64Array | BigInt64Array);
    }
    const columns = indices.length;
    const buffer = kind === 'integer' ? new BigInt64Array(table.length * columns) : new Float64Array(table.length * columns);
    for (let column = 0; column < columns; column += 1) {
        checkpoint('processing table');
        const source = sources[column], target = buffer;
        for (let row = 0; row < table.length; row += 1) {
            (target as unknown as Record<number, unknown>)[row * columns + column] = source[row];
        }
    }
    return buffer;
}

/** Columns into a rows-by-columns matrix carrying the column names. */
function projectColumns(table: RankArrowTable, fields: readonly RankValue[]): RankArray {
    const names = fields.map(field => {
        const name = fieldName(field);
        if (name === undefined) throw new RankError('table column selection expects labels or text', 'TypeError');
        return name;
    });
    const indices = names.map(name => {
        const index = table.indexOf(name);
        if (index < 0) throw new MissingValueError(`missing object key: ${name}`);
        return index;
    });
    const columns = indices.length;
    const buffer = typedMatrix(table, indices);
    if (buffer) return typedArray(buffer, [table.length, columns], names);
    const items: RankValue[] = new Array(table.length * columns);
    for (let row = 0; row < table.length; row += 1) {
        checkpoint('processing table');
        for (let column = 0; column < columns; column += 1) {
            const value = table.cell(row, indices[column]);
            if (value === undefined) throw new MissingValueError(`missing object key: ${names[column]}`, true);
            items[row * columns + column] = value;
        }
    }
    return ownedArray(items, [table.length, columns], false, names);
}

/**
 * `Data .Age = Values` replaces or adds a column; `Data 5 .Age = Value` writes
 * one cell. Either returns a new table, and the caller rebinds the name.
 * `operator` is the binary operator of a compound assignment.
 */
export function writeTable(
    table: RankArrowTable, selectors: readonly RankValue[], value: RankValue,
    operator: string | undefined, binary: (operator: string, left: RankValue, right: RankValue) => RankValue,
): RankArrowTable {
    const last = selectors.at(-1);
    const name = last === undefined ? undefined : fieldName(last);
    if (name === undefined || selectors.length > 2
        || (selectors.length === 2 && typeof selectors[0] !== 'bigint')) {
        throw new RankError('table assignment expects a column, or a row and a column', 'TypeError');
    }
    if (selectors.length === 2) {
        const row = selectors[0] as bigint;
        if (row < 0n || row >= BigInt(table.length)) throw new MissingValueError(`table row out of bounds: ${row}`);
        let written = value;
        if (operator !== undefined) {
            const previous = table.cell(Number(row), table.indexOf(name));
            if (previous === undefined) throw new MissingValueError(`missing object key: ${name}`);
            written = binary(operator, previous, value);
        }
        if (isRankArray(written)) {
            throw new RankError('a table cell holds one value', 'TypeError');
        }
        return table.withCell(Number(row), name, written);
    }
    let result = value;
    if (operator !== undefined) result = binary(operator, table.columnArray(name), value);
    const cells: (RankValue | undefined)[] = new Array(table.length);
    if (isRankArray(result)) {
        if (!sameShape([table.length], result.shape)) {
            throw new RankError(`assignment shape mismatch: ${table.length} and ${result.shape}`, 'DimensionMismatch');
        }
        for (let row = 0; row < table.length; row += 1) {
            checkpoint('processing table');
            cells[row] = readArrayItem(result, row);
        }
    } else cells.fill(result);
    const hint = table.columns[table.indexOf(name)]?.kind;
    return table.withColumn(columnFromValues(name, cells, hint));
}
