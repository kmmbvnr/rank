import { checkpoint } from '../interrupt.js';
import { StoredValueSummary } from './stored-value.js';
import { isRankArray, isRankSqliteTable, isRankTableAlias, type RankGroupedTable, type RankObject, type RankValue } from './value.js';
import { RankError } from '../errors.js';
import { ownedObject } from './array-storage.js';
import { sqliteColumns } from '../modules/sqlite.js';
import { sortByKeys } from '../modules/sequence-order.js';
import { tableRows, tableKey } from './table-rows.js';

/** Stored inputs only: do not run a query, read a lazy cell or retain a result. */
export function* groupedTableValues(value: RankGroupedTable): IterableIterator<RankValue> {
    if (value.sqliteSource) yield value.sqliteSource;
    if (value.rollingSource) yield value.rollingSource;
    if (value.columnar) yield value.columnar.table;
    for (const group of value.groups) {
        for (const key of group.keys) {
            checkpoint('processing table');
            if (key !== undefined) yield key;
        }
        for (const row of group.rows) { checkpoint('processing table'); yield row; }
    }
    for (const group of value.columnar?.groups ?? []) {
        for (const key of group.keys) {
            checkpoint('processing table');
            if (key !== undefined) yield key;
        }
    }
}

/** A grouping is ready only when all the values it retains are ready. */
export function ownedGroupedTable(value: Omit<RankGroupedTable, 'kind'>): RankGroupedTable {
    const result: RankGroupedTable = { kind: 'grouped-table', ...value };
    const stored = new StoredValueSummary();
    for (const child of groupedTableValues(result)) {
        checkpoint('processing table');
        stored.include(child);
    }
    return stored.track(result);
}

export function groupTable(source: RankValue, fields: readonly string[], rollup = false): RankGroupedTable {
    if (new Set(fields).size !== fields.length) {
        throw new RankError('group by fields must be unique', 'TypeError');
    }
    const input = isRankTableAlias(source) ? source.source : source;
    if (isRankSqliteTable(input)) {
        const columns = sqliteColumns(input);
        for (const field of fields) {
            checkpoint('processing table');
            if (!columns.includes(field)) {
                throw new RankError(`SQLite column does not exist: .${field}`, 'Missing');
            }
        }
        return ownedGroupedTable({ fields, groups: [], sqliteSource: input, rollup });
    }
    const rows = tableRows(input, 'group by');
    const groups: { keys: (RankValue | undefined)[]; rows: RankObject[] }[] = [];
    const positions = new Map<string, number>();
    const add = (row: RankObject | undefined, level: number): void => {
        const keys = fields.map((field, index) => index < level ? row?.entries.get(field) : undefined);
        const id = JSON.stringify([level, row ? tableKey(row, fields.slice(0, level), true) : '[]']);
        let position = positions.get(id);
        if (position === undefined) {
            position = groups.length;
            positions.set(id, position);
            groups.push({ keys, rows: [] });
        }
        if (row) groups[position].rows.push(row);
    };
    for (const sourceRow of rows) {
        checkpoint('processing table');
        const row = ownedObject(sourceRow.entries);
        for (let level = fields.length; level >= (rollup ? 0 : fields.length); level -= 1) {
            checkpoint('processing table');
            add(row, level);
        }
    }
    if (rollup && rows.length === 0) add(undefined, 0);
    return ownedGroupedTable({ fields, groups, rollup });
}

export function rollingTable(source: RankValue, width: RankValue, field: string): RankGroupedTable {
    if (typeof width !== 'bigint' || width < 1n || width > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RankError('rolling width must be a positive integer', 'TypeError');
    }
    const input = isRankTableAlias(source) ? source.source : source;
    const rolling = { width: Number(width), field };
    if (isRankSqliteTable(input)) {
        if (!sqliteColumns(input).includes(field)) {
            throw new RankError(`SQLite column does not exist: .${field}`, 'Missing');
        }
        return ownedGroupedTable({ fields: [field], groups: [], sqliteSource: input, rolling });
    }
    if (!isRankArray(input) || input.shape.length !== 1) {
        throw new RankError('rolling by expects a rank-1 table', 'DimensionMismatch');
    }
    const rows = tableRows(input, 'rolling by').map(row => ownedObject(row.entries));
    if (rows.some(row => !row.entries.has(field))) {
        throw new RankError(`rolling by requires .${field} in every row`, 'Missing');
    }
    const sorted = sortByKeys(rows, rows.map(row => [row.entries.get(field)]), 'rolling by');
    return ownedGroupedTable({ fields: [field], groups: [], rollingSource: sorted, rolling });
}
