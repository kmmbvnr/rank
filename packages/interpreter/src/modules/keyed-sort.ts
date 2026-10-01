import { RankArrowTable } from '../arrow-table.js';
import { MissingValueError, RankError } from '../errors.js';
import { sortTable } from '../table-ops.js';
import { isRankArray, isRankObject, isRankRecord, isRankSqliteTable, isRankTable, type RankArray, type RankValue } from '../value.js';
import { sortByItems, sortByKeys } from './sequences.js';
import { sortSqlite } from './sqlite.js';

/** One `.field` of `sort by`, with the direction as written. */
export interface SortField {
    readonly name: string;
    readonly direction: unknown;
}

type KeyedSortOperation = 'sort by' | 'argsort by';

/**
 * `Source sort by .a .b` and `argsort by`: rows ordered by named fields. A
 * SQLite view or a column table sorts in place; other sources sort a snapshot
 * of their rows. No Rank code runs.
 */
export function sortByFields(source: RankValue, fields: readonly SortField[], operation: KeyedSortOperation): RankValue {
    const indices = operation === 'argsort by';
    if (isRankSqliteTable(source) && !indices) {
        return sortSqlite(source, fields.map(field => field.name), fields.map(field => sortFieldDescending(field.direction)));
    }
    if (isRankTable(source) && !indices) {
        return sortTable(source, fields.map(field => field.name), fields.map(field => sortFieldDescending(field.direction)));
    }
    const plan = keyedSort(source, operation);
    const keys = plan.items.map(item => fields.map(field => {
        if (!isRankRecord(item) && !isRankObject(item)) {
            throw new RankError(`${operation} fields expects records`, 'TypeError');
        }
        return item.entries.get(field.name);
    }));
    for (const [index, field] of fields.entries()) {
        if (keys.length > 0 && !keys.some(row => row[index] !== undefined)
            && (!isRankArray(source)
                || !source.columnNames?.includes(field.name))) {
            throw new MissingValueError(
                `${operation} record is missing field .${field.name}`,
            );
        }
    }
    return plan.finish(keys, fields.map(field => sortFieldDescending(field.direction)));
}

/**
 * The rows `Source sort by Key` orders. The caller runs the key function on
 * each item, since it is Rank code that may suspend, then finishes the sort
 * with one key row per item. The result keeps the source's table schema.
 */
export function keyedSort(source: RankValue, operation: KeyedSortOperation): {
    readonly items: RankValue[];
    finish(keys: (RankValue | undefined)[][], descending: boolean[]): RankValue;
} {
    const indices = operation === 'argsort by';
    // A key function reads whole rows, so it works on a snapshot of them.
    const tableSource = isRankTable(source) ? source : undefined;
    const items = sortByItems(tableSource ? tableSource.toRows() : source, operation);
    const resultWithSchema = (result: RankArray): RankValue => {
        if (tableSource && !indices) return RankArrowTable.fromRows(result.items, tableSource.names);
        if (!indices && isRankArray(source) && source.columnNames) {
            Object.defineProperty(result, 'columnNames', { value: source.columnNames });
        }
        return result;
    };
    return { items, finish: (keys, descending) => resultWithSchema(sortByKeys(items, keys, operation, indices, descending)) };
}

/** A field direction as written: `.ascending`, `.descending` or nothing. */
export function sortFieldDescending(direction: unknown): boolean {
    const value = typeof direction === 'string' ? direction
        : direction && typeof direction === 'object' && 'name' in direction
            ? (direction as { name?: unknown }).name
            : undefined;
    const name = typeof value === 'string' ? value.replace(/^\./, '') : undefined;
    if (name && name !== 'ascending' && name !== 'descending') {
        throw new RankError('sort direction must be .ascending or .descending', 'TypeError');
    }
    return name === 'descending';
}
