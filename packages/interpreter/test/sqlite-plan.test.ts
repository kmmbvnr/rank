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
                columns: () => sql.includes('sqlite_master') ? ['name'] : ['name'],
                all: params => {
                    if (sql.includes('sqlite_master')) return [{ name: 'facilities' }];
                    this.reads.push({ sql, params });
                    return [{ name: 'Tennis Court 1' }];
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
