import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { Interpreter, formatValue, parse } from '../../interpreter/out/index.js';
import { nodeIo } from '../out/node-io.js';

function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'rank-sqlite-bindings-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'data.sqlite3');
    const db = new Database(path);
    t.after(() => db.close());
    db.exec(`CREATE TABLE items(id INTEGER, name TEXT);
        INSERT INTO items VALUES (1, 'first'), (2, 'second');
        CREATE TABLE lineitem(l_shipdate TEXT, l_discount REAL, l_quantity INTEGER, l_extendedprice REAL);
        INSERT INTO lineitem VALUES
            ('1994-01-01', 0.05, 23, 100),
            ('1994-12-31', 0.07, 1, 200),
            ('1993-12-31', 0.06, 1, 1000),
            ('1995-01-01', 0.06, 1, 1000),
            ('1994-06-01', 0.04, 1, 1000),
            ('1994-06-01', 0.08, 1, 1000),
            ('1994-06-01', 0.06, 24, 1000);`);
    let reads = 0;
    let opens = 0;
    let closes = 0;
    const io = { ...nodeIo, openSqlite(path) {
        opens++;
        const connection = nodeIo.openSqlite(path);
        return { ...connection, prepare(sql) {
            const statement = connection.prepare(sql);
            return { ...statement, all(params) {
                if (!sql.includes('sqlite_master') && !sql.startsWith('EXPLAIN')) reads++;
                return statement.all(params);
            } };
        }, close() { closes++; connection.close(); } };
    } };
    return { path, db, io, reads: () => reads, balanced: () => assert.equal(opens, closes) };
}

for (const compilation of [false, true]) {
    test(`SQLite binding completion and repeated query demand (compilation=${compilation})`, { timeout: 10000 }, t => {
        const data = fixture(t);
        const runtime = new Interpreter(undefined, { io: data.io, compilation });
        t.after(() => runtime.dispose());
        runtime.execute(`use tables\nuse sequences\nDb = ${JSON.stringify(data.path)} sqlite
Rows' = (Db .items) sort by .id
Selected' = Rows (Rows .id greater 1)
Statement = Selected sql`);
        assert.equal(data.reads(), 0);
        assert.match(formatValue(runtime.execute('Statement .text')), /WHERE/);
        runtime.execute('Saved = Selected');
        assert.equal(data.reads(), 1);
        assert.equal(formatValue(runtime.execute('Saved .name')), 'second');
        data.db.exec("UPDATE items SET name = 'changed' WHERE id = 2");
        assert.equal(formatValue(runtime.execute('Saved .name')), 'second');
        for (let repeat = 0; repeat < 2; repeat++) {
            assert.equal(formatValue(runtime.execute('(Selected array) .name')), 'changed');
        }
        assert.equal(data.reads(), 3);
        runtime.execute('Flags = Rows .id greater 1');
        assert.equal(formatValue(runtime.execute('Flags')), 'false true');
        assert.equal(data.reads(), 4);
        data.balanced();
    });

    test(`TPC-H Q6 pilot keeps SQL pushdown (compilation=${compilation})`, { timeout: 10000 }, t => {
        const data = fixture(t);
        const output = [];
        const runtime = new Interpreter(text => output.push(text), { io: data.io, compilation });
        t.after(() => runtime.dispose());
        const source = readFileSync(new URL('../../../demos/tpch/001_q6_sqlite.ra', import.meta.url), 'utf8');
        runtime.executeProgram(parse(source), [data.path]);
        assert.deepEqual(output, ['19']);
        assert.equal(data.reads(), 1);
        data.balanced();
    });
}
