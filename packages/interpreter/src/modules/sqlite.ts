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
    isRankRecord,
    isRankObject,
    isRankTableAlias,
    type RankArray,
    type RankDate,
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
import type { GroupAggregateSpec } from './tables.js';

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
        writeTarget: { name, params: [] },
    };
}

export function sqliteCalendar(
    database: RankSqliteDatabase, start: RankDate, end: RankDate,
): RankSqliteTable {
    const first = formatDate(start);
    const last = formatDate(end);
    return { kind: 'sqlite-table', database,
        text: 'WITH RECURSIVE days(date) AS (SELECT ? WHERE ? <= ? '
            + "UNION ALL SELECT date(date, '+1 day') FROM days WHERE date < ?) "
            + 'SELECT date FROM days',
        params: [first, first, last, last], textColumns: new Set(['date']) };
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

export function sqliteWindowNumber(
    table: RankSqliteTable, kind: 'rownumber' | 'ranknumber',
): RankSqliteExpression {
    if (!table.orderBy?.length) {
        throw new RankError(`SQLite ${kind} requires sort by before select`, 'TypeError');
    }
    const order = table.orderBy.flatMap(({ field, descending }) =>
        [`${quote(field)} IS NULL`, quote(field) + (descending ? ' DESC' : '')]).join(', ');
    return { kind: 'sqlite-expression', table,
        text: `${kind === 'rownumber' ? 'ROW_NUMBER' : 'RANK'}() OVER (ORDER BY ${order})`,
        params: [], boolean: false, window: kind };
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
    let windowField: string | undefined;
    for (const [name, value] of fields.entries) {
        if (isRankSqliteExpression(value)) {
            if (value.table !== table) {
                throw new RankError(`select field .${name} belongs to another SQLite view`, 'TypeError');
            }
            columns.push(`${value.text} AS ${quote(name)}`);
            params.push(...value.params);
            if (value.boolean) booleanColumns.add(name);
            if (value.textual) textColumns.add(name);
            if (value.window && windowField === undefined) windowField = name;
        } else {
            columns.push(`? AS ${quote(name)}`);
            params.push(toSqlite(value));
            if (typeof value === 'boolean') booleanColumns.add(name);
            if (typeof value === 'string') textColumns.add(name);
        }
    }
    return { kind: 'sqlite-table', database: table.database,
        text: `SELECT ${columns.join(', ')} FROM (${table.text}) AS source`
            + (windowField ? ` ORDER BY ${quote(windowField)}` : ''),
        params: [...params, ...table.params], booleanColumns, textColumns,
        orderBy: windowField ? [{ field: windowField, descending: false }] : undefined };
}

export function filterSqlite(table: RankSqliteTable, predicate: RankSqliteExpression): RankSqliteTable {
    if (predicate.table !== table || !predicate.boolean) {
        throw new RankError('SQLite filter expects a boolean expression from this table', 'TypeError');
    }
    return { kind: 'sqlite-table', database: table.database, scopes: table.scopes,
        booleanColumns: table.booleanColumns, textColumns: table.textColumns,
        text: `SELECT * FROM (${table.text}) AS source WHERE ${predicate.text}`,
        params: [...table.params, ...predicate.params],
        writeTarget: table.writeTarget && {
            name: table.writeTarget.name,
            where: table.writeTarget.where
                ? `(${table.writeTarget.where}) AND (${predicate.text})` : predicate.text,
            params: [...table.writeTarget.params, ...predicate.params],
        } };
}

export function sortSqlite(
    table: RankSqliteTable, fields: readonly string[], descending: readonly boolean[] = [],
): RankSqliteTable {
    for (const field of fields) requireColumn(table, field);
    return { kind: 'sqlite-table', database: table.database, scopes: table.scopes,
        booleanColumns: table.booleanColumns, textColumns: table.textColumns,
        text: `SELECT * FROM (${table.text}) AS source ORDER BY ${fields.flatMap((field, index) =>
            [`${quote(field)} IS NULL`, quote(field) + (descending[index] ? ' DESC' : '')]).join(', ')}`,
        params: table.params,
        orderBy: fields.map((field, index) => ({ field, descending: descending[index] ?? false })) };
}

export function sliceSqlite(table: RankSqliteTable, start: bigint, stop: bigint): RankSqliteTable {
    if (start < 0n || stop < 0n) {
        throw new RankError('slice bounds must be nonnegative', 'TypeError');
    }
    const size = lengthSqlite(table);
    if (start > size || stop > size) {
        throw new RankError(`slice ${start} until ${stop} exceeds axis size ${size}`);
    }
    return { kind: 'sqlite-table', database: table.database,
        text: `SELECT * FROM (${table.text}) AS source`
            + (table.orderBy ? ` ORDER BY ${table.orderBy.flatMap(({ field, descending }) =>
                [`${quote(field)} IS NULL`, quote(field) + (descending ? ' DESC' : '')]).join(', ')}` : '')
            + ' LIMIT ? OFFSET ?',
        params: [...table.params, stop > start ? stop - start : 0n, start],
        booleanColumns: table.booleanColumns, textColumns: table.textColumns,
        orderBy: table.orderBy };
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
    and: 'AND', or: 'OR', '+': '+', '-': '-', '*': '*', '/': '/', '//': '//',
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
    if (operator === '//' && (right === 0n || right === 0)) {
        throw new RankError('division by zero');
    }
    if (operator === '//') {
        return { kind: 'sqlite-expression', table,
            text: `floor((1.0 * ${a.text}) / ${b.text})`,
            params: [...a.params, ...b.params], boolean: false };
    }
    if (operator === '/') {
        return { kind: 'sqlite-expression', table,
            text: `((1.0 * ${a.text}) / ${b.text})`,
            params: [...a.params, ...b.params], boolean: false };
    }
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

/** Correlated scalar lookup; `source` is the alias of the outer expression host. */
export function lookupSqlite(
    requested: RankSqliteExpression,
    key: RankSqliteExpression,
    value: RankSqliteExpression,
): RankSqliteExpression {
    if (key.table !== value.table
        || requested.table.database.path !== key.table.database.path) {
        throw new RankError('SQLite lookup expects one source view and database', 'TypeError');
    }
    const qualify = (text: string, alias: string) => text.replace(
        /"(?:[^"]|"")+"/g,
        (identifier, offset: number) => text[offset - 1] === '.'
            ? identifier : `${alias}.${identifier}`,
    );
    const innerKey = qualify(key.text, 'found');
    const outerKey = qualify(requested.text, 'source');
    const equality = compatibleEquality(innerKey, outerKey);
    const matchParams = [...key.params, ...requested.params];
    return { kind: 'sqlite-expression', table: requested.table,
        text: `(SELECT ${qualify(value.text, 'found')} FROM (${key.table.text}) AS found `
            + `WHERE ${equality} LIMIT 1)`,
        params: [...value.params, ...key.table.params,
            ...matchParams, ...matchParams, ...matchParams],
        boolean: value.boolean, textual: value.textual };
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

/** Return one lazy row per key; no source rows are read while planning. */
export function selectGroupedSqlite(
    source: RankSqliteTable, keys: readonly string[], specs: readonly GroupAggregateSpec[],
    rollup = false,
): RankSqliteTable {
    const columns = sqliteColumns(source);
    const keyColumns = keys.map(quote);
    const aggregates = specs.map(spec => {
        if (spec.field && !columns.includes(spec.field)) {
            throw new RankError(`SQLite column does not exist: .${spec.field}`, 'Missing');
        }
        if (spec.operation === 'median' || spec.operation === 'std') {
            throw new RankError(`SQLite grouped ${spec.operation} is not supported yet`, 'TypeError');
        }
        const field = spec.field ? quote(spec.field) : '*';
        const expression = spec.operation === 'count' ? `COUNT(${field})`
            : spec.operation === 'sum' ? `COALESCE(SUM(${field}), 0)`
                : spec.operation === 'mean' ? `AVG(${field})`
                    : `${spec.operation.toUpperCase()}(${field})`;
        return `${expression} AS ${quote(spec.name)}`;
    });
    const levels = rollup ? Array.from({ length: keys.length + 1 }, (_, index) => keys.length - index)
        : [keys.length];
    const queries = levels.map(level => {
        const outputKeys = keys.map((key, index) => index < level
            ? quote(key) : `NULL AS ${quote(key)}`);
        return `SELECT ${[...outputKeys, ...aggregates].join(', ')} FROM (${source.text}) AS source`
            + (level > 0 ? ` GROUP BY ${keyColumns.slice(0, level).join(', ')}` : '');
    });
    return { kind: 'sqlite-table', database: source.database,
        text: queries.join(' UNION ALL '),
        params: levels.flatMap(() => source.params),
        booleanColumns: new Set(keys.filter(key => source.booleanColumns?.has(key))),
        textColumns: new Set(keys.filter(key => source.textColumns?.has(key))) };
}

export function selectRollingSqlite(
    source: RankSqliteTable, rolling: { readonly width: number; readonly field: string },
    specs: readonly GroupAggregateSpec[],
): RankSqliteTable {
    const columns = sqliteColumns(source);
    const order = quote(rolling.field);
    const frame = `ORDER BY ${order} IS NULL, ${order} ROWS BETWEEN ${rolling.width - 1} PRECEDING AND CURRENT ROW`;
    const aggregates = specs.map(spec => {
        if (spec.field && !columns.includes(spec.field)) {
            throw new RankError(`SQLite column does not exist: .${spec.field}`, 'Missing');
        }
        if (spec.operation === 'median' || spec.operation === 'std') {
            throw new RankError(`SQLite rolling ${spec.operation} is not supported yet`, 'TypeError');
        }
        const field = spec.field ? quote(spec.field) : '*';
        const aggregate = spec.operation === 'mean' ? 'AVG' : spec.operation.toUpperCase();
        const expression = `${aggregate}(${field}) OVER (${frame})`;
        return `${spec.operation === 'sum' ? `COALESCE(${expression}, 0)` : expression} AS ${quote(spec.name)}`;
    });
    return { kind: 'sqlite-table', database: source.database,
        text: `SELECT ${[`${order} AS ${order}`, ...aggregates].join(', ')} FROM (${source.text}) AS source`
            + ` ORDER BY ${order} IS NULL, ${order}`,
        params: source.params,
        textColumns: new Set(source.textColumns?.has(rolling.field) ? [rolling.field] : []),
        orderBy: [{ field: rolling.field, descending: false }] };
}

export function maxSqlite(expression: RankSqliteExpression): RankValue {
    return withConnection(expression.table.database, connection => {
        const row = connection.prepare(`SELECT MAX(${expression.text}) AS value `
            + `FROM (${expression.table.text}) AS source`)
            .all([...expression.params, ...expression.table.params])[0];
        if (!row || row.value === null) throw new MissingValueError('max of an empty SQLite column');
        if (typeof row.value !== 'bigint' && typeof row.value !== 'number') {
            throw new RankError('SQLite max expects numeric values', 'TypeError');
        }
        return fromSqlite(row.value);
    });
}

export function inSqlite(left: RankSqliteExpression, right: RankSqliteTable, negated = false): RankSqliteExpression {
    if (left.table.database.path !== right.database.path || left.table.database.io !== right.database.io) {
        throw new RankError('SQLite in expects one database', 'TypeError');
    }
    const columns = sqliteColumns(right);
    if (columns.length !== 1) throw new RankError('SQLite in expects one column', 'TypeError');
    return { kind: 'sqlite-expression', table: left.table,
        text: `${left.text} ${negated ? 'NOT IN' : 'IN'} `
            + `(SELECT ${quote(columns[0])} FROM (${right.text}) AS values_)`,
        params: [...left.params, ...right.params], boolean: true };
}

export interface SqliteWrite {
    readonly database: RankSqliteDatabase;
    readonly text: string;
    readonly params: readonly SqliteScalar[];
}

export function sqliteWrite(
    table: RankSqliteTable, operation: 'insert' | 'update' | 'delete',
    values: readonly RankValue[] = [], fields?: RankRecord,
): SqliteWrite {
    const target = table.writeTarget;
    if (!target || (operation === 'insert' && target.where)) {
        throw new RankError('SQLite write requires a base table or its filtered view', 'TypeError');
    }
    const name = quote(target.name);
    const columns = sqliteColumns(sqliteTable(table.database, target.name));
    const checked = (field: string): string => {
        if (!columns.includes(field)) throw new RankError(`SQLite column does not exist: .${field}`, 'Missing');
        return quote(field);
    };
    if (operation === 'delete') return { database: table.database,
        text: `DELETE FROM ${name} AS source${target.where ? ` WHERE ${target.where}` : ''}`,
        params: target.params };
    if (operation === 'update') {
        if (!fields || fields.entries.size === 0) throw new RankError('update needs fields', 'TypeError');
        const params: SqliteScalar[] = [];
        const changes = [...fields.entries].map(([field, value]) => {
            if (isRankSqliteExpression(value)) {
                if (value.table !== table) throw new RankError('update field belongs to another view', 'TypeError');
                params.push(...value.params);
                return `${checked(field)} = ${value.text}`;
            }
            params.push(toSqlite(value));
            return `${checked(field)} = ?`;
        });
        return { database: table.database,
            text: `UPDATE ${name} AS source SET ${changes.join(', ')}`
                + (target.where ? ` WHERE ${target.where}` : ''),
            params: [...params, ...target.params] };
    }
    if (values.length === 1 && isRankSqliteTable(values[0])) {
        const source = values[0];
        if (source.database.path !== table.database.path || source.database.io !== table.database.io) {
            throw new RankError('insert source must use the same database', 'TypeError');
        }
        const names = sqliteColumns(source);
        for (const field of names) checked(field);
        return { database: table.database,
            text: `INSERT INTO ${name} (${names.map(quote).join(', ')}) ${source.text}`,
            params: source.params };
    }
    const rows = values.length === 1 && isRankArray(values[0])
        ? values[0].items : values;
    if (rows.length === 0) throw new RankError('insert needs rows', 'TypeError');
    const first = rows[0];
    if (!isRankRecord(first) && !isRankObject(first)) {
        throw new RankError('insert expects records or a table of rows', 'TypeError');
    }
    const names = [...first.entries.keys()];
    if (names.length === 0) throw new RankError('insert row needs fields', 'TypeError');
    for (const field of names) checked(field);
    const params: SqliteScalar[] = [];
    for (const row of rows) {
        if ((!isRankRecord(row) && !isRankObject(row))
            || row.entries.size !== names.length || names.some(field => !row.entries.has(field))) {
            throw new RankError('insert rows must have matching fields', 'TypeError');
        }
        for (const field of names) params.push(toSqlite(row.entries.get(field)!));
    }
    const placeholders = `(${names.map(() => '?').join(', ')})`;
    return { database: table.database,
        text: `INSERT INTO ${name} (${names.map(quote).join(', ')}) VALUES `
            + rows.map(() => placeholders).join(', '), params };
}

export function executeSqliteWrite(write: SqliteWrite, mode?: 'sql' | 'explain'): RankValue {
    if (mode === 'sql') return { kind: 'record',
        entries: new Map<string, RankValue>([
            ['text', write.text],
            ['params', { kind: 'array', items: write.params.map(fromSqlite), shape: [write.params.length] }],
        ]), types: new Map([['text', 'text'], ['params', 'array']]) };
    if (mode === 'explain') return withConnection(write.database, connection =>
        resultRows(connection.prepare(`EXPLAIN QUERY PLAN ${write.text}`), write.params));
    const open = write.database.io.openSqliteWrite;
    if (!open) throw new RankError('SQLite writing is unavailable in this host', 'IO');
    let connection: RankSqliteConnection;
    try { connection = open.call(write.database.io, write.database.path); }
    catch (error) { throw new RankError(`SQLite open failed: ${String(error)}`, 'IO'); }
    try {
        const statement = connection.prepare(write.text);
        if (statement.readonly || !statement.run) throw new RankError('expected a SQLite write', 'TypeError');
        return BigInt(statement.run(write.params));
    } catch (error) {
        if (error instanceof RankError) throw error;
        throw new RankError(`SQLite write failed: ${String(error)}`, 'Sqlite');
    } finally { connection.close(); }
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
