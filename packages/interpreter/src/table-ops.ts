import { RankArrowTable, columnFromValues } from './arrow-table.js';
import { readArrayItem } from './array-storage.js';
import { MissingValueError, RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { aggregateGroup, type GroupAggregateSpec } from './modules/tables.js';
import { sortByKeys } from './modules/sequences.js';
import { setValueKey } from './set.js';
import {
    isRankArray, isRankDate, isRankLabel, isRankSqliteExpression,
    type RankArray, type RankGroupedTable, type RankRecord, type RankValue,
} from './value.js';

const ABSENT = '\u0000';
const SEPARATOR = '\u0001';

/** Rows where the mask holds, in order. The mask has one boolean per row. */
export function filterTable(table: RankArrowTable, mask: RankArray): RankArrowTable {
    if (mask.shape.length !== 1 || mask.shape[0] !== table.length) {
        throw new RankError('filter requires a boolean mask with one value per row', 'TypeError');
    }
    const rows: number[] = [];
    for (let row = 0; row < table.length; row += 1) {
        checkpoint('processing table');
        const flag = readArrayItem(mask, row);
        if (typeof flag !== 'boolean') {
            throw new RankError('filter requires a boolean mask with one value per row', 'TypeError');
        }
        if (flag) rows.push(row);
    }
    return table.takeRows(rows);
}

/** A table of the named columns: arrays with one value per row, or scalars that
 * fill their column. A cell whose source is absent stays absent. */
export function selectColumns(table: RankArrowTable, fields: RankRecord): RankArrowTable {
    if (fields.entries.size === 0) throw new RankError('select requires at least one field', 'TypeError');
    const columns = [...fields.entries].map(([name, value]) => {
        checkpoint('processing table');
        if (isRankSqliteExpression(value)) {
            throw new RankError(`select field .${name} belongs to a SQLite view`, 'TypeError');
        }
        const cells: (RankValue | undefined)[] = new Array(table.length);
        if (isRankArray(value)) {
            if (value.shape.length !== 1 || value.shape[0] !== table.length) {
                throw new RankError(`select field .${name} must have one value per row`, 'DimensionMismatch');
            }
            for (let row = 0; row < table.length; row += 1) {
                checkpoint('processing table');
                try { cells[row] = readArrayItem(value, row); } catch (error) {
                    if (!(error instanceof MissingValueError)) throw error;
                }
            }
        } else cells.fill(value);
        return columnFromValues(name, cells);
    });
    return new RankArrowTable(table.length, columns);
}

/** Stable sort by key columns. The result remembers its keys, which `ranknumber` reads. */
export function sortTable(
    table: RankArrowTable, fields: readonly string[], descending: readonly boolean[],
): RankArrowTable {
    const indices = fields.map(field => {
        const index = table.indexOf(field);
        if (index < 0 && table.length > 0) {
            throw new MissingValueError(`sort by record is missing field .${field}`);
        }
        return index;
    });
    const keys = Array.from({ length: table.length }, (_, row) => {
        checkpoint('processing table');
        return indices.map(index => index < 0 ? undefined : table.cell(row, index));
    });
    const order = sortByKeys(Array.from({ length: table.length }, (_, row) => BigInt(row)), keys,
        'sort by', false, descending);
    const rows = order.items.map(row => Number(row));
    const sorted = table.takeRows(rows);
    return sorted.withSortKeys((order.sortKeys ?? []) as readonly (readonly (RankValue | undefined)[])[]);
}

function keyPart(value: RankValue | undefined, field: string): string {
    if (value === undefined) return ABSENT;
    if (!(typeof value === 'bigint' || typeof value === 'number'
        || typeof value === 'boolean' || typeof value === 'string'
        || isRankLabel(value) || isRankDate(value))) {
        throw new RankError(`table key .${field} must be scalar`, 'TypeError');
    }
    if (typeof value === 'number' && Number.isNaN(value)) {
        throw new RankError(`table key .${field} cannot be NaN`, 'DomainError');
    }
    return setValueKey(value);
}

/** Groups in order of first appearance, each holding its row numbers. */
export function groupColumnar(table: RankArrowTable, fields: readonly string[], rollup: boolean): RankGroupedTable {
    const indices = fields.map(field => table.indexOf(field));
    const groups: { keys: (RankValue | undefined)[]; rows: number[] }[] = [];
    const positions = new Map<string, number>();
    const lowest = rollup ? 0 : fields.length;
    const cells: (RankValue | undefined)[] = new Array(fields.length);
    const parts: string[] = new Array(fields.length);
    for (let row = 0; row < table.length; row += 1) {
        checkpoint('processing table');
        for (let field = 0; field < fields.length; field += 1) {
            const value = indices[field] < 0 ? undefined : table.cell(row, indices[field]);
            cells[field] = value;
            parts[field] = keyPart(value, fields[field]);
        }
        for (let level = fields.length; level >= lowest; level -= 1) {
            const id = rollup ? `${level}${SEPARATOR}${parts.slice(0, level).join(SEPARATOR)}`
                : parts.join(SEPARATOR);
            let position = positions.get(id);
            if (position === undefined) {
                position = groups.length;
                positions.set(id, position);
                groups.push({ keys: fields.map((_, index) => index < level ? cells[index] : undefined), rows: [] });
            }
            groups[position].rows.push(row);
        }
    }
    if (rollup && table.length === 0) groups.push({ keys: fields.map(() => undefined), rows: [] });
    return { kind: 'grouped-table', fields, groups: [], rollup, columnar: { table, groups } };
}

/** Aggregates of a columnar grouping, one table row per group. */
export function selectGroupedColumnar(
    grouped: RankGroupedTable, specs: readonly GroupAggregateSpec[],
): RankArrowTable {
    const { table, groups } = grouped.columnar!;
    const names = [...grouped.fields, ...specs.map(spec => spec.name)];
    const rows = groups.map(group => aggregateGroup(group.keys, group.rows.length, field => {
        const index = table.indexOf(field);
        const values: RankValue[] = [];
        if (index < 0) return values;
        for (const row of group.rows) {
            const value = table.cell(row, index);
            if (value !== undefined) values.push(value);
        }
        return values;
    }, grouped.fields, specs));
    return new RankArrowTable(rows.length, names.map(name => columnFromValues(name, rows.map(row => row.get(name)))));
}

/** Inner or left join on key columns; the left order is kept, and each left
 * row repeats once per match. */
export function joinColumnar(
    left: RankArrowTable, right: RankArrowTable, leftFields: readonly string[],
    mode: 'leftjoin' | 'innerjoin', rightFields: readonly string[] = leftFields,
): RankArrowTable {
    if (leftFields.length !== rightFields.length
        || new Set(leftFields).size !== leftFields.length
        || new Set(rightFields).size !== rightFields.length) {
        throw new RankError(`${mode} key fields must be distinct and aligned`, 'TypeError');
    }
    const leftKeys = leftFields.map(field => {
        const index = left.indexOf(field);
        if (index < 0) throw new MissingValueError(`${mode} left key .${field} is missing`);
        return index;
    });
    const rightKeys = rightFields.map(field => {
        const index = right.indexOf(field);
        if (index < 0) throw new MissingValueError(`${mode} right key .${field} is missing`);
        return index;
    });
    const rightValues = right.names.map((name, index) => ({ name, index }))
        .filter(column => !rightFields.includes(column.name));
    for (const { name } of rightValues) {
        checkpoint('processing table');
        if (left.indexOf(name) >= 0) {
            throw new RankError(`${mode} has duplicate non-key column .${name}`, 'TypeError');
        }
    }
    const keyOf = (table: RankArrowTable, row: number, indices: readonly number[], fields: readonly string[]) => {
        const parts: string[] = [];
        for (let position = 0; position < indices.length; position += 1) {
            const value = table.cell(row, indices[position]);
            if (value === undefined) return undefined;
            parts.push(keyPart(value, fields[position]));
        }
        return parts.join(SEPARATOR);
    };
    const matches = new Map<string, number[]>();
    for (let row = 0; row < right.length; row += 1) {
        checkpoint('processing table');
        const key = keyOf(right, row, rightKeys, rightFields);
        if (key === undefined) continue;
        const bucket = matches.get(key);
        if (bucket) bucket.push(row); else matches.set(key, [row]);
    }
    const leftRows: number[] = [];
    const rightRows: number[] = [];
    for (let row = 0; row < left.length; row += 1) {
        checkpoint('processing table');
        const key = keyOf(left, row, leftKeys, leftFields);
        const hits = key === undefined ? undefined : matches.get(key);
        if (hits === undefined) {
            if (mode === 'leftjoin') { leftRows.push(row); rightRows.push(-1); }
            continue;
        }
        for (const hit of hits) { leftRows.push(row); rightRows.push(hit); }
    }
    const columns = [
        ...left.names.map((name, index) => columnFromValues(name,
            leftRows.map(row => left.cell(row, index)), left.columns[index].kind)),
        ...rightValues.map(({ name, index }) => columnFromValues(name,
            rightRows.map(row => row < 0 ? undefined : right.cell(row, index)), right.columns[index].kind)),
    ];
    return new RankArrowTable(leftRows.length, columns);
}
