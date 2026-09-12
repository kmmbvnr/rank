import { ByteArray } from '../bytes.js';
import { RankError } from '../errors.js';
import type { RankSqliteConnection, SqliteScalar } from '../io.js';
import {
    formatDate,
    isRankArray,
    isRankBytes,
    isRankDate,
    isRankSqliteDatabase,
    isRankSqliteTable,
    type RankArray,
    type RankObject,
    type RankSqliteDatabase,
    type RankSqliteTable,
    type RankValue,
} from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const sqliteModule: RuntimeModule = {
    sqlite: context => native('sqlite', 1, ([path]) => {
        if (typeof path !== 'string') throw new RankError('sqlite expects a file path', 'TypeError');
        if (!context.io?.openSqlite) throw new RankError('SQLite is unavailable in this host', 'IO');
        const database: RankSqliteDatabase = { kind: 'sqlite-database', path, io: context.io };
        withConnection(database, () => undefined);
        return database;
    }),
    sql: () => native('sql', 1, ([value]) => {
        const table = expectTable(value, 'sql');
        return {
            kind: 'record',
            entries: new Map<string, RankValue>([
                ['text', table.text],
                ['params', { kind: 'array', items: table.params.map(fromSqlite), shape: [table.params.length] }],
            ]),
            types: new Map([['text', 'text'], ['params', 'array']]),
        };
    }),
    explain: () => native('explain', 1, ([value]) => {
        const table = expectTable(value, 'explain');
        return withConnection(table.database, connection =>
            resultRows(connection.prepare(`EXPLAIN QUERY PLAN ${table.text}`), table.params));
    }),
    sqlquery: () => native('sqlquery', 3, ([databaseValue, text, paramsValue]) => {
        const database = expectDatabase(databaseValue);
        if (typeof text !== 'string' || !/^\s*(SELECT|WITH)\b/i.test(text)) {
            throw new RankError('sqlquery expects one SELECT statement', 'TypeError');
        }
        if (!isRankArray(paramsValue) || paramsValue.shape.length !== 1) {
            throw new RankError('sqlquery parameters must be a rank-1 array', 'TypeError');
        }
        const params = paramsValue.items.map(toSqlite);
        withConnection(database, connection => {
            const statement = connection.prepare(text);
            if (!statement.readonly || !statement.reader) {
                throw new RankError('sqlquery expects a read-only SELECT', 'TypeError');
            }
            // Validate bindings without reading result rows.
            connection.prepare(`EXPLAIN QUERY PLAN ${text}`).all(params);
        });
        return { kind: 'sqlite-table', database, text, params };
    }),
};

export function sqliteTable(database: RankSqliteDatabase, name: string): RankSqliteTable {
    const exists = withConnection(database, connection => connection.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
    ).all([name]).length > 0);
    if (!exists) throw new RankError(`SQLite table does not exist: ${name}`, 'Missing');
    return {
        kind: 'sqlite-table', database,
        text: `SELECT * FROM "${name.replace(/"/g, '""')}"`,
        params: [],
    };
}

export function materializeSqlite(table: RankSqliteTable): RankArray {
    return withConnection(table.database, connection =>
        resultRows(connection.prepare(table.text), table.params));
}

function resultRows(
    statement: ReturnType<RankSqliteConnection['prepare']>,
    params: readonly SqliteScalar[],
): RankArray {
    const columns = [...statement.columns()];
    if (new Set(columns).size !== columns.length) {
        throw new RankError('SQLite result columns must have unique names', 'TypeError');
    }
    const items: RankValue[] = statement.all(params).map(row => {
        const entries = new Map<string, RankValue>();
        for (const name of columns) {
            const value = row[name];
            if (value !== null && value !== undefined) entries.set(name, fromSqlite(value));
        }
        return { kind: 'object', entries } satisfies RankObject;
    });
    return { kind: 'array', items, shape: [items.length], columnNames: columns };
}

function toSqlite(value: RankValue): SqliteScalar {
    if (typeof value === 'bigint' || typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value ? 1n : 0n;
    if (isRankDate(value)) return formatDate(value);
    if (isRankBytes(value)) return value.data;
    throw new RankError('sqlquery parameter must be a finite scalar, date or bytes', 'TypeError');
}

function fromSqlite(value: SqliteScalar): RankValue {
    if (value === null) throw new RankError('unexpected SQLite NULL', 'TypeError');
    if (value instanceof Uint8Array) return new ByteArray(value);
    return value;
}

function expectTable(value: RankValue, operation: string): RankSqliteTable {
    if (!isRankSqliteTable(value)) throw new RankError(`${operation} expects a SQLite table`, 'TypeError');
    return value;
}

function expectDatabase(value: RankValue): RankSqliteDatabase {
    if (!isRankSqliteDatabase(value)) throw new RankError('sqlquery expects a SQLite database', 'TypeError');
    return value;
}

function withConnection<T>(database: RankSqliteDatabase, run: (connection: RankSqliteConnection) => T): T {
    const open = database.io.openSqlite;
    if (!open) throw new RankError('SQLite is unavailable in this host', 'IO');
    let connection: RankSqliteConnection;
    try { connection = open(database.path); }
    catch (error) { throw new RankError(`SQLite open failed: ${String(error)}`, 'IO'); }
    try { return run(connection); }
    catch (error) {
        if (error instanceof RankError) throw error;
        throw new RankError(`SQLite query failed: ${String(error)}`, 'Sqlite');
    }
    finally { connection.close(); }
}
