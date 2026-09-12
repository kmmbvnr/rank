import { ByteArray } from '../bytes.js';
import { MissingValueError, RankError } from '../errors.js';
import type { RankSqliteConnection, SqliteScalar } from '../io.js';
import {
    formatDate,
    isRankArray,
    isRankBytes,
    isRankDate,
    isRankSqliteDatabase,
    isRankSqliteExpression,
    isRankSqliteTable,
    isRankTableAlias,
    type RankArray,
    type RankObject,
    type RankSqliteDatabase,
    type RankSqliteExpression,
    type RankSqliteTable,
    type RankSqliteScope,
    type RankRecord,
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
        resultRows(connection.prepare(table.text), table.params, table.scopes, table.booleanColumns));
}

export function sqliteColumns(table: RankSqliteTable): readonly string[] {
    return withConnection(table.database, connection => {
        const columns = connection.prepare(table.text).columns();
        if (new Set(columns).size !== columns.length) {
            throw new RankError('SQLite result columns must have unique names', 'TypeError');
        }
        return columns;
    });
}

function quote(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

function compatibleEquality(left: string, right: string): string {
    const numeric = (value: string) => `typeof(${value}) IN ('integer', 'real')`;
    return `((typeof(${left}) = typeof(${right}) OR (${numeric(left)} AND ${numeric(right)})) AND ${left} = ${right})`;
}

function requireColumn(table: RankSqliteTable, name: string): void {
    if (!sqliteColumns(table).includes(name)) {
        throw new RankError(`SQLite column does not exist: .${name}`, 'Missing');
    }
}

export function sqliteColumn(table: RankSqliteTable, name: string): RankSqliteExpression {
    requireColumn(table, name);
    return { kind: 'sqlite-expression', table, text: quote(name), params: [],
        boolean: table.booleanColumns?.has(name) ?? false,
        textual: table.textColumns?.has(name) ?? false };
}

export function sqliteScope(table: RankSqliteTable, name: string): RankSqliteScope {
    if (!table.scopes?.has(name)) throw new RankError(`SQLite scope does not exist: .${name}`, 'Missing');
    return { kind: 'sqlite-scope', table, name };
}

export function sqliteScopedColumn(scope: RankSqliteScope, name: string): RankSqliteExpression {
    if (!scope.table.scopes?.get(scope.name)?.includes(name)) {
        throw new RankError(`SQLite column does not exist: .${scope.name} .${name}`, 'Missing');
    }
    return { kind: 'sqlite-expression', table: scope.table,
        text: quote(`${scope.name}.${name}`), params: [],
        boolean: scope.table.booleanColumns?.has(`${scope.name}.${name}`) ?? false,
        textual: scope.table.textColumns?.has(`${scope.name}.${name}`) ?? false };
}

export function projectSqlite(table: RankSqliteTable, fields: readonly string[]): RankSqliteTable {
    if (fields.length === 0) {
        throw new RankError('SQLite projection requires at least one field', 'TypeError');
    }
    if (new Set(fields).size !== fields.length) {
        throw new RankError('SQLite projection fields must be distinct', 'TypeError');
    }
    for (const field of fields) requireColumn(table, field);
    return { kind: 'sqlite-table', database: table.database,
        text: `SELECT ${fields.map(quote).join(', ')} FROM (${table.text}) AS source`,
        params: table.params,
        booleanColumns: new Set(fields.filter(field => table.booleanColumns?.has(field))),
        textColumns: new Set(fields.filter(field => table.textColumns?.has(field))) };
}

/** Give expressions final column names without reading rows. */
export function selectSqlite(table: RankSqliteTable, fields: RankRecord): RankSqliteTable {
    if (fields.entries.size === 0) {
        throw new RankError('select requires at least one field', 'TypeError');
    }
    const columns: string[] = [];
    const params: SqliteScalar[] = [];
    const booleanColumns = new Set<string>();
    const textColumns = new Set<string>();
    for (const [name, value] of fields.entries) {
        if (isRankSqliteExpression(value)) {
            if (value.table !== table) {
                throw new RankError(`select field .${name} belongs to another SQLite view`, 'TypeError');
            }
            columns.push(`${value.text} AS ${quote(name)}`);
            params.push(...value.params);
            if (value.boolean) booleanColumns.add(name);
            if (value.textual) textColumns.add(name);
        } else {
            columns.push(`? AS ${quote(name)}`);
            params.push(toSqlite(value));
            if (typeof value === 'boolean') booleanColumns.add(name);
            if (typeof value === 'string') textColumns.add(name);
        }
    }
    return { kind: 'sqlite-table', database: table.database,
        text: `SELECT ${columns.join(', ')} FROM (${table.text}) AS source`,
        params: [...params, ...table.params], booleanColumns, textColumns };
}

export function filterSqlite(table: RankSqliteTable, predicate: RankSqliteExpression): RankSqliteTable {
    if (predicate.table !== table || !predicate.boolean) {
        throw new RankError('SQLite filter expects a boolean expression from this table', 'TypeError');
    }
    return { kind: 'sqlite-table', database: table.database, scopes: table.scopes,
        booleanColumns: table.booleanColumns, textColumns: table.textColumns,
        text: `SELECT * FROM (${table.text}) AS source WHERE ${predicate.text}`,
        params: [...table.params, ...predicate.params] };
}

export function sortSqlite(table: RankSqliteTable, fields: readonly string[]): RankSqliteTable {
    for (const field of fields) requireColumn(table, field);
    return { kind: 'sqlite-table', database: table.database, scopes: table.scopes,
        booleanColumns: table.booleanColumns, textColumns: table.textColumns,
        text: `SELECT * FROM (${table.text}) AS source ORDER BY ${fields.map(quote).join(', ')}`,
        params: table.params };
}

export function uniqueSqlite(table: RankSqliteTable): RankSqliteTable {
    sqliteColumns(table);
    return { kind: 'sqlite-table', database: table.database, scopes: table.scopes,
        booleanColumns: table.booleanColumns, textColumns: table.textColumns,
        text: `SELECT DISTINCT * FROM (${table.text}) AS source`, params: table.params };
}

export function joinSqlite(
    left: RankSqliteTable, right: RankSqliteTable,
    leftFields: readonly string[], rightFields: readonly string[], mode: 'leftjoin' | 'innerjoin',
): RankSqliteTable {
    if (left.database.path !== right.database.path || leftFields.length !== rightFields.length
        || new Set(leftFields).size !== leftFields.length
        || new Set(rightFields).size !== rightFields.length) {
        throw new RankError('SQLite join expects one database and distinct aligned keys', 'TypeError');
    }
    const leftNames = sqliteColumns(left);
    const rightNames = sqliteColumns(right);
    for (const field of leftFields) if (!leftNames.includes(field)) requireColumn(left, field);
    for (const field of rightFields) if (!rightNames.includes(field)) requireColumn(right, field);
    const rightValues = rightNames.filter(name => !rightFields.includes(name));
    for (const name of rightValues) {
        if (leftNames.includes(name)) {
            throw new RankError(`${mode} has duplicate non-key column .${name}`, 'TypeError');
        }
    }
    const select = [
        ...leftNames.map(name => `l.${quote(name)} AS ${quote(name)}`),
        ...rightValues.map(name => `r.${quote(name)} AS ${quote(name)}`),
    ].join(', ');
    const keys = leftFields.map((name, index) =>
        compatibleEquality(`l.${quote(name)}`, `r.${quote(rightFields[index])}`)).join(' AND ');
    const typed = (kind: 'booleanColumns' | 'textColumns') => new Set([
        ...leftNames.filter(name => left[kind]?.has(name)),
        ...rightValues.filter(name => right[kind]?.has(name)),
    ]);
    return { kind: 'sqlite-table', database: left.database,
        text: `SELECT ${select} FROM (${left.text}) AS l ${mode === 'leftjoin' ? 'LEFT' : 'INNER'} JOIN (${right.text}) AS r ON ${keys}`,
        params: [...left.params, ...right.params],
        booleanColumns: typed('booleanColumns'), textColumns: typed('textColumns') };
}

export function joinAliasedSqlite(
    left: RankSqliteTable, right: RankSqliteTable, leftName: string, rightName: string,
    leftFields: readonly string[], rightFields: readonly string[], mode: 'leftjoin' | 'innerjoin',
): RankSqliteTable {
    if (leftName === rightName) throw new RankError(`${mode} aliases must differ`, 'TypeError');
    if (left.database.path !== right.database.path || leftFields.length !== rightFields.length
        || new Set(leftFields).size !== leftFields.length
        || new Set(rightFields).size !== rightFields.length) {
        throw new RankError('SQLite join expects one database and distinct aligned keys', 'TypeError');
    }
    const leftNames = sqliteColumns(left);
    const rightNames = sqliteColumns(right);
    for (const field of leftFields) if (!leftNames.includes(field)) requireColumn(left, field);
    for (const field of rightFields) if (!rightNames.includes(field)) requireColumn(right, field);
    const l = quote(leftName);
    const r = quote(rightName);
    const select = [
        ...leftNames.map(name => `${l}.${quote(name)} AS ${quote(`${leftName}.${name}`)}`),
        ...rightNames.map(name => `${r}.${quote(name)} AS ${quote(`${rightName}.${name}`)}`),
    ].join(', ');
    const keys = leftFields.map((name, index) =>
        compatibleEquality(`${l}.${quote(name)}`, `${r}.${quote(rightFields[index])}`)).join(' AND ');
    const typed = (kind: 'booleanColumns' | 'textColumns') => new Set([
        ...leftNames.filter(name => left[kind]?.has(name)).map(name => `${leftName}.${name}`),
        ...rightNames.filter(name => right[kind]?.has(name)).map(name => `${rightName}.${name}`),
    ]);
    return { kind: 'sqlite-table', database: left.database,
        text: `SELECT ${select} FROM (${left.text}) AS ${l} ${mode === 'leftjoin' ? 'LEFT' : 'INNER'} JOIN (${right.text}) AS ${r} ON ${keys}`,
        params: [...left.params, ...right.params],
        scopes: new Map([[leftName, leftNames], [rightName, rightNames]]),
        booleanColumns: typed('booleanColumns'), textColumns: typed('textColumns'),
    };
}

const sqlOperators: Readonly<Record<string, string>> = {
    equal: '=', notequal: '<>', less: '<', greater: '>', atleast: '>=', atmost: '<=',
    and: 'AND', or: 'OR', '+': '+', '-': '-', '*': '*',
};

export function binarySqlite(
    operator: string, left: RankValue, right: RankValue,
): RankSqliteExpression {
    const op = sqlOperators[operator];
    if (!op) throw new RankError(`SQLite expression does not support ${operator}`, 'TypeError');
    const leftExpr = isRankSqliteExpression(left) ? left : undefined;
    const rightExpr = isRankSqliteExpression(right) ? right : undefined;
    const table = leftExpr?.table ?? rightExpr?.table;
    if (!table || (leftExpr && rightExpr && leftExpr.table !== rightExpr.table)) {
        throw new RankError('SQLite expression operands must come from one table', 'TypeError');
    }
    if ((operator === 'and' || operator === 'or')
        && ((leftExpr && !leftExpr.boolean) || (rightExpr && !rightExpr.boolean))) {
        throw new RankError('SQLite logical operands must be boolean', 'TypeError');
    }
    const operand = (value: RankValue): { text: string; params: readonly SqliteScalar[] } =>
        isRankSqliteExpression(value) ? value : { text: '?', params: [toSqlite(value)] };
    const a = operand(left);
    const b = operand(right);
    const textOperator = operator === '+' && (typeof left === 'string' || typeof right === 'string'
        || leftExpr?.textual || rightExpr?.textual)
        ? '||' : op;
    if (operator === 'equal' || operator === 'notequal') {
        const equality = compatibleEquality(a.text, b.text);
        const text = operator === 'equal' ? equality : `(NOT ${equality})`;
        return { kind: 'sqlite-expression', table, text,
            params: [...a.params, ...b.params, ...a.params, ...b.params,
                ...a.params, ...b.params], boolean: true };
    }
    return { kind: 'sqlite-expression', table,
        text: `(${a.text} ${textOperator} ${b.text})`, params: [...a.params, ...b.params],
        textual: textOperator === '||',
        boolean: ['equal', 'notequal', 'less', 'greater', 'atleast', 'atmost', 'and', 'or'].includes(operator) };
}

/** Preserve a missing condition as NULL instead of taking the false branch. */
export function chooseSqlite(
    condition: RankValue, whenTrue: RankValue, whenFalse: RankValue,
): RankSqliteExpression {
    const expressions = [condition, whenTrue, whenFalse].filter(isRankSqliteExpression);
    const table = expressions[0]?.table;
    if (!table || expressions.some(expression => expression.table !== table)) {
        throw new RankError('SQLite choose operands must come from one table', 'TypeError');
    }
    if (isRankSqliteExpression(condition) ? !condition.boolean : typeof condition !== 'boolean') {
        throw new RankError('choose expects a boolean condition', 'TypeError');
    }
    const operand = (value: RankValue) => isRankSqliteExpression(value)
        ? { text: value.text, params: value.params }
        : { text: '?', params: [toSqlite(value)] };
    const test = operand(condition);
    const yes = operand(whenTrue);
    const no = operand(whenFalse);
    const knownBoolean = (value: RankValue) => typeof value === 'boolean'
        || (isRankSqliteExpression(value) && value.boolean);
    const knownText = (value: RankValue) => typeof value === 'string'
        || (isRankSqliteExpression(value) && value.textual === true);
    return { kind: 'sqlite-expression', table,
        text: `CASE WHEN ${test.text} THEN ${yes.text} WHEN NOT (${test.text}) THEN ${no.text} END`,
        params: [...test.params, ...yes.params, ...test.params, ...no.params],
        boolean: knownBoolean(whenTrue) && knownBoolean(whenFalse),
        textual: knownText(whenTrue) && knownText(whenFalse) };
}

export function sumSqlite(expression: RankSqliteExpression): RankValue {
    const table = expression.table;
    return withConnection(table.database, connection => {
        const statement = connection.prepare(
            `SELECT COALESCE(SUM(${expression.text}), 0) AS value FROM (${table.text}) AS source`,
        );
        const value = statement.all([...expression.params, ...table.params])[0]?.value;
        if (typeof value !== 'bigint' && typeof value !== 'number') {
            throw new RankError('SQLite sum expects numeric values', 'TypeError');
        }
        return value;
    });
}

export function lengthSqlite(table: RankSqliteTable): bigint {
    return withConnection(table.database, connection => {
        const value = connection.prepare(`SELECT COUNT(*) AS value FROM (${table.text}) AS source`)
            .all(table.params)[0]?.value;
        if (typeof value !== 'bigint' && typeof value !== 'number') {
            throw new RankError('SQLite count failed', 'Sqlite');
        }
        return BigInt(value);
    });
}

export function materializeSqliteExpression(expression: RankSqliteExpression): RankArray {
    const table = expression.table;
    const rows = withConnection(table.database, connection => connection.prepare(
        `SELECT ${expression.text} AS value FROM (${table.text}) AS source`,
    ).all([...expression.params, ...table.params]));
    return { kind: 'array', items: rows.map(row => {
        if (row.value === null) throw new MissingValueError('SQLite column contains NULL');
        return fromSqlite(row.value);
    }), shape: [rows.length] };
}

function resultRows(
    statement: ReturnType<RankSqliteConnection['prepare']>,
    params: readonly SqliteScalar[],
    scopes?: ReadonlyMap<string, readonly string[]>,
    booleanColumns?: ReadonlySet<string>,
): RankArray {
    const columns = [...statement.columns()];
    if (new Set(columns).size !== columns.length) {
        throw new RankError('SQLite result columns must have unique names', 'TypeError');
    }
    const firstScope = scopes?.keys().next().value;
    const items: RankValue[] = statement.all(params).map(row => {
        if (scopes) {
            const entries = new Map<string, RankValue>();
            for (const [scope, fields] of scopes) {
                const nested = new Map<string, RankValue>();
                for (const field of fields) {
                    const value = row[`${scope}.${field}`];
                    if (value !== null && value !== undefined) {
                        nested.set(field, fromColumn(value, `${scope}.${field}`, booleanColumns));
                    }
                }
                if (nested.size > 0 || scope === firstScope) {
                    entries.set(scope, { kind: 'object', entries: nested });
                }
            }
            return { kind: 'object', entries } satisfies RankObject;
        }
        const entries = new Map<string, RankValue>();
        for (const name of columns) {
            const value = row[name];
            if (value !== null && value !== undefined) {
                entries.set(name, fromColumn(value, name, booleanColumns));
            }
        }
        return { kind: 'object', entries } satisfies RankObject;
    });
    return { kind: 'array', items, shape: [items.length],
        columnNames: scopes ? [...scopes.keys()] : columns,
        tableScopes: scopes ? [...scopes.keys()] : undefined };
}

function fromColumn(value: SqliteScalar, name: string, booleanColumns?: ReadonlySet<string>): RankValue {
    if (booleanColumns?.has(name)) {
        if (typeof value !== 'bigint' && typeof value !== 'number') {
            throw new RankError(`SQLite boolean column .${name} is not numeric`, 'TypeError');
        }
        return value !== 0 && value !== 0n;
    }
    return fromSqlite(value);
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
    if (isRankTableAlias(value)) value = value.source;
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
    try { connection = open.call(database.io, database.path); }
    catch (error) { throw new RankError(`SQLite open failed: ${String(error)}`, 'IO'); }
    try { return run(connection); }
    catch (error) {
        if (error instanceof RankError) throw error;
        throw new RankError(`SQLite query failed: ${String(error)}`, 'Sqlite');
    }
    finally { connection.close(); }
}
