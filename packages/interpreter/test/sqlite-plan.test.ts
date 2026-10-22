import { afterEach, describe, expect, it } from 'vitest';
import { Interpreter, formatValue, type RankSqliteConnection, type RankSqliteTable, type SqliteScalar } from '../src/index.js';
import { identifySqliteSource, sameSqliteSource } from '../src/sqlite-source.js';
import { MemoryIo } from './support.js';

class CountingSqliteIo extends MemoryIo {
    readonly reads: { sql: string; params: readonly SqliteScalar[] }[] = [];

    name = 'Tennis Court 1';
    fail = false;

    openSqlite(_path: string): RankSqliteConnection {
        return {
            prepare: sql => ({
                readonly: true,
                reader: true,
                columns: () => sql.includes('AS "title"') ? ['title'] : ['name'],
                all: params => {
                    if (sql.includes('sqlite_master')) return [{ name: 'facilities' }];
                    this.reads.push({ sql, params });
                    if (this.fail) throw new Error('read failed');
                    if (sql.includes('AS value')) return [{ value: this.name }];
                    return sql.includes('AS "title"')
                        ? [{ title: this.name }] : [{ name: this.name }];
                },
            }),
            close: () => undefined,
        };
    }
}

it('requires both query provenance and matching bindings across reconstructed sources', () => {
    const database = { kind: 'sqlite-database' as const, path: 'club.sqlite3', io: new CountingSqliteIo({}) };
    const source = {};
    const query = (params: SqliteScalar[], identity = source, text = 'SELECT ? AS name') =>
        identifySqliteSource({ kind: 'sqlite-table', database, text, params }, identity) as RankSqliteTable;
    expect(sameSqliteSource(query([1n]), query([1n]))).toBe(true);
    expect(sameSqliteSource(query([1n]), query([2n]))).toBe(false);
    expect(sameSqliteSource(query([1n]), query([1n], {}))).toBe(false);
    expect(sameSqliteSource(query([1n]), query([1n], source, 'SELECT ? AS id'))).toBe(false);
    expect(sameSqliteSource(query([new Uint8Array([1])]), query([new Uint8Array([1])]))).toBe(true);
    expect(sameSqliteSource(query([new Uint8Array([1])]), query([new Uint8Array([2])]))).toBe(false);
});

describe.each([false, true])('SQLite plans (compilation=%s)', compilation => {
    const runtimes: Interpreter[] = [];
    const createRuntime = (io: CountingSqliteIo) => {
        const runtime = new Interpreter(undefined, { io, compilation });
        runtimes.push(runtime);
        return runtime;
    };
    afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); });

    it('builds and inspects SQLite views without reading rows until array', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute('use tables\nDb = "club.sqlite3" sqlite\nFacilities\' = Db .facilities\n'
            + 'Selected\' = Facilities (Facilities .name equal "Tennis Court 1")\n'
            + 'Result\' = Selected (array .name)\nStatement = Result sql');
        expect(io.reads).toEqual([]);
        expect(formatValue(runtime.execute('Statement .text')!)).toContain('WHERE');
        expect(io.reads).toEqual([]);
        runtime.execute('Rows = Result array');
        expect(formatValue(runtime.execute('Rows .name')!)).toBe('Tennis Court 1');
        expect(io.reads).toHaveLength(1);
        expect(io.reads[0].params).toEqual([
            'Tennis Court 1', 'Tennis Court 1', 'Tennis Court 1',
        ]);
    });

    it('names a SQLite column without reading rows before materialization', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute('use tables\nDb = "club.sqlite3" sqlite\nFacilities\' = Db .facilities\n'
            + 'Out\' = Facilities select\n  .title = .name\nend\nStatement = Out sql');
        expect(io.reads).toEqual([]);
        expect(formatValue(runtime.execute('Statement .text')!)).toContain('AS "title"');
        runtime.execute('Rows = Out array');
        expect(formatValue(runtime.execute('Rows .title')!)).toBe('Tennis Court 1');
        expect(io.reads).toHaveLength(1);
    });

    it('pushes select rownumber into an ordered SQLite window', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute('use tables\nuse sequences\nDb = "club.sqlite3" sqlite\n'
            + 'R\' = Db .facilities\nR\' = R sort by .name\n'
            + 'Out\' = R select\n  .number = rownumber\n  .title = .name\nend\n'
            + 'Statement = Out sql');
        expect(io.reads).toEqual([]);
        const sql = formatValue(runtime.execute('Statement .text')!);
        expect(sql).toContain('ROW_NUMBER() OVER (ORDER BY');
        expect(sql).toContain('ORDER BY "number"');
        expect(() => runtime.execute('Bad = Db .facilities select\n'
            + '  .number = rownumber\nend')).toThrowError('requires sort by');
    });

    it('pushes select ranknumber into an ordered SQLite window', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute('use tables\nuse sequences\nDb = "club.sqlite3" sqlite\n'
            + 'R\' = Db .facilities\nR\' = R sort by .name .descending\n'
            + 'Out\' = R select\n  .rank = ranknumber\n  .title = .name\nend\n'
            + 'Statement = Out sql');
        expect(io.reads).toEqual([]);
        const sql = formatValue(runtime.execute('Statement .text')!);
        expect(sql).toContain('RANK() OVER (ORDER BY');
        expect(sql).toContain('"name" DESC');
        expect(() => runtime.execute('Bad = Db .facilities select\n'
            + '  .rank = ranknumber\nend')).toThrowError('requires sort by');
    });

    it('keeps choose as a SQLite expression until a row is requested', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute('use sequences\nuse tables\nDb = "club.sqlite3" sqlite\n'
            + 'Rows\' = Db .facilities\n'
            + 'Flag\' = Rows .name equal "Tennis Court 1"\n'
            + 'Value\' = Flag "yes" "no" choose\n'
            + 'Out\' = Rows select\n  .title = Value\nend\nStatement = Out sql');
        expect(io.reads).toEqual([]);
        expect(formatValue(runtime.execute('Statement .text')!)).toContain('CASE WHEN');
    });

    it('keeps a correlated lookup in the plan until a row is requested', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute('use tables\nDb = "club.sqlite3" sqlite\n'
            + 'Rows\' = Db .facilities\n'
            + 'Ids\' = Rows .name\nKeys\' = Rows .name\n'
            + 'Found\' = Ids Keys Keys lookup\n'
            + 'Out\' = Rows select\n  .title = Found\nend\nStatement = Out sql');
        expect(io.reads).toEqual([]);
        expect(formatValue(runtime.execute('Statement .text')!)).toContain('AS found');
    });

    it('keeps contextual filters, calculations and descending sort in a bound plan', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute('use tables\nuse sequences\nDb = "club.sqlite3" sqlite\n'
            + 'R\' = Db .facilities filter .name equal "Tennis Court 1"\n'
            + 'R\' = R select\n  Flag = .name equal "Tennis Court 1"\n'
            + '  .title = Flag .name "fallback" choose\nend\n'
            + 'R\' = R sort by .title .descending\nStatement = R sql');
        expect(io.reads).toEqual([]);
        const text = formatValue(runtime.execute('Statement .text')!);
        expect(text).toContain('WHERE');
        expect(text).toContain('CASE WHEN');
        expect(text).toContain('"title" DESC');
        expect(text).not.toContain('Tennis Court 1');
        expect(formatValue(runtime.execute('Statement .params')!)).toContain('Tennis Court 1');
        runtime.execute('Rows = R array');
        expect(io.reads).toHaveLength(1);
    });


    it('reads ordinary bindings once and replays an explicit query against current data', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute(`use tables
    Db = "club.sqlite3" sqlite
    Query' = Db .facilities`);
        expect(io.reads).toHaveLength(0);
        runtime.execute('Rows = Query');
        expect(io.reads).toHaveLength(1);
        io.name = 'changed';
        expect(formatValue(runtime.execute('Rows .name')!)).toBe('Tennis Court 1');
        expect(formatValue(runtime.execute('(Query array) .name')!)).toBe('changed');
        expect(formatValue(runtime.execute('(Query array) .name')!)).toBe('changed');
        expect(io.reads).toHaveLength(3);
        runtime.execute('Names = Query .name');
        expect(formatValue(runtime.execute('Names')!)).toBe('changed');
        expect(io.reads).toHaveLength(4);
    });

    it('completes nested native queries and columns at an ordinary binding', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute(`use tables
    Db = "club.sqlite3" sqlite
    Query' = Db .facilities`);
        const query = runtime.execute('Query')!;
        const column = runtime.execute('Query .name')!;
        runtime.variables.set('Bundle', { kind: 'record', entries: new Map([
            ['rows', query], ['names', column],
        ]), types: new Map([['rows', 'sqlite-table'], ['names', 'sqlite-expression']]) });
        runtime.execute('Saved = Bundle');
        expect(io.reads).toHaveLength(2);
        expect(formatValue(runtime.execute('(Saved .rows) .name')!)).toBe('Tennis Court 1');
        expect(formatValue(runtime.execute('Saved .names')!)).toBe('Tennis Court 1');
        expect(runtime.variables.get('Saved')).not.toBe(runtime.variables.get('Bundle'));
    });

    it('completes ordinary parameters but preserves deferred query arguments', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute(`use tables
    Db = "club.sqlite3" sqlite
    Query' = Db .facilities
    fun X pass = X
    fun X' keep = X
    Rows = Query pass`);
        expect(io.reads).toHaveLength(1);
        runtime.execute("Later' = Query keep");
        expect(io.reads).toHaveLength(1);
        expect(formatValue(runtime.execute('(Later array) .name')!)).toBe('Tennis Court 1');
        expect(io.reads).toHaveLength(2);
    });

    it('does not equate independently captured queries with identical SQL', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute(`use tables
    Db = "club.sqlite3" sqlite
    A' = Db .facilities
    B' = Db .facilities
    Invalid' = A (B .name equal "Tennis Court 1")`);
        expect(() => runtime.execute('Invalid array')).toThrowError('from this table');
        expect(io.reads).toHaveLength(0);
    });

    it('retries a failed query demand without retaining a result or publishing a binding', () => {
        const io = new CountingSqliteIo({});
        const runtime = createRuntime(io);
        runtime.execute(`use tables
    Db = "club.sqlite3" sqlite
    Query' = Db .facilities`);
        io.fail = true;
        expect(() => runtime.execute('Saved = Query')).toThrowError('read failed');
        expect(runtime.variables.has('Saved')).toBe(false);
        io.fail = false;
        runtime.execute('Saved = Query');
        expect(io.reads).toHaveLength(2);
        expect(formatValue(runtime.execute('Saved .name')!)).toBe('Tennis Court 1');
    });

});
