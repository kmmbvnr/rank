import { expect, it } from 'vitest';
import { Interpreter, formatValue, type RankSqliteConnection, type SqliteScalar } from '../src/index.js';
import { MemoryIo } from './support.js';

class CountingSqliteIo extends MemoryIo {
    readonly reads: { sql: string; params: readonly SqliteScalar[] }[] = [];

    openSqlite(_path: string): RankSqliteConnection {
        return {
            prepare: sql => ({
                readonly: true,
                reader: true,
                columns: () => sql.includes('AS "title"') ? ['title'] : ['name'],
                all: params => {
                    if (sql.includes('sqlite_master')) return [{ name: 'facilities' }];
                    this.reads.push({ sql, params });
                    return sql.includes('AS "title"')
                        ? [{ title: 'Tennis Court 1' }] : [{ name: 'Tennis Court 1' }];
                },
            }),
            close: () => undefined,
        };
    }
}

it('builds and inspects SQLite views without reading rows until array', () => {
    const io = new CountingSqliteIo({});
    const runtime = new Interpreter(undefined, { io });
    runtime.execute('use tables\nDb = "club.sqlite3" sqlite\nFacilities = Db .facilities\n'
        + 'Selected = Facilities (Facilities .name equal "Tennis Court 1")\n'
        + 'Result = Selected (array .name)\nStatement = Result sql');
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
    const runtime = new Interpreter(undefined, { io });
    runtime.execute('use tables\nDb = "club.sqlite3" sqlite\nFacilities = Db .facilities\n'
        + 'Cols = record\n  .title = Facilities .name\nend\n'
        + 'Out = Facilities Cols select\nStatement = Out sql');
    expect(io.reads).toEqual([]);
    expect(formatValue(runtime.execute('Statement .text')!)).toContain('AS "title"');
    runtime.execute('Rows = Out array');
    expect(formatValue(runtime.execute('Rows .title')!)).toBe('Tennis Court 1');
    expect(io.reads).toHaveLength(1);
});

it('keeps choose as a SQLite expression until a row is requested', () => {
    const io = new CountingSqliteIo({});
    const runtime = new Interpreter(undefined, { io });
    runtime.execute('use sequences\nuse tables\nDb = "club.sqlite3" sqlite\n'
        + 'Rows = Db .facilities\n'
        + 'Flag = Rows .name equal "Tennis Court 1"\n'
        + 'Value = Flag "yes" "no" choose\n'
        + 'Cols = record\n  .title = Value\nend\n'
        + 'Out = Rows Cols select\nStatement = Out sql');
    expect(io.reads).toEqual([]);
    expect(formatValue(runtime.execute('Statement .text')!)).toContain('CASE WHEN');
});

it('keeps a correlated lookup in the plan until a row is requested', () => {
    const io = new CountingSqliteIo({});
    const runtime = new Interpreter(undefined, { io });
    runtime.execute('use tables\nDb = "club.sqlite3" sqlite\n'
        + 'Rows = Db .facilities\n'
        + 'Ids = Rows .name\nKeys = Rows .name\n'
        + 'Found = Ids Keys Keys lookup\n'
        + 'Cols = record\n  .title = Found\nend\n'
        + 'Out = Rows Cols select\nStatement = Out sql');
    expect(io.reads).toEqual([]);
    expect(formatValue(runtime.execute('Statement .text')!)).toContain('AS found');
});
