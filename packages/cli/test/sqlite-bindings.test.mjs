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

    test(`SQLite aliases and join scopes complete at ordinary bindings (compilation=${compilation})`, { timeout: 10000 }, t => {
        const data = fixture(t);
        const runtime = new Interpreter(undefined, { io: data.io, compilation });
        t.after(() => runtime.dispose());
        runtime.execute(`use tables
Db = ${JSON.stringify(data.path)} sqlite
Left' = Db .items alias .left
Right' = (Db .items filter .id greater 1) alias .right
Joined' = Left Right leftjoin on
 .id equal .id
Scope' = Joined .right`);
        assert.equal(data.reads(), 0);
        runtime.execute('ReadyAlias = Left');
        const alias = runtime.variables.get('ReadyAlias');
        assert.equal(alias.kind, 'table-alias');
        assert.equal(alias.name, 'left');
        assert.equal(alias.source.kind, 'array');
        assert.equal(data.reads(), 1);
        runtime.execute('ReadyScope = Scope');
        const scope = runtime.variables.get('ReadyScope');
        assert.equal(scope.kind, 'array');
        assert.equal(scope.shape[0], 2);
        assert.deepEqual(scope.columnNames, ['id', 'name']);
        assert.equal(scope.items[0].kind, 'missing');
        assert.equal(scope.items[1].entries.get('name'), 'second');
        assert.equal(data.reads(), 2);
        data.db.exec("UPDATE items SET name = 'changed' WHERE id = 2");
        assert.equal(scope.items[1].entries.get('name'), 'second');
        assert.equal(runtime.execute('Scope array').items[1].entries.get('name'), 'changed');
        assert.equal(data.reads(), 3);
        data.balanced();
    });

    for (const [operation, expected, changed] of [
        ['group by .name', [1n, 2n], [1n, 12n]],
        ['rollup by .name', [1n, 2n, 3n], [1n, 12n, 13n]],
        ['2 rolling by .id', [1n, 3n], [1n, 13n]],
    ]) {
        test(`SQLite ${operation} respects group retention (compilation=${compilation})`, { timeout: 10000 }, t => {
            const data = fixture(t);
            const runtime = new Interpreter(undefined, { io: data.io, compilation });
            t.after(() => runtime.dispose());
            const select = `select
 .n = count
 .total = .id sum
end`;
            const totals = rows => rows.items.map(row => row.entries.get('total'))
                .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
            runtime.execute(`use tables
use sequences
Db = ${JSON.stringify(data.path)} sqlite
Source' = Db .items
Groups' = Source ${operation}`);
            assert.equal(data.reads(), 0);
            runtime.execute('Saved = Groups');
            assert.equal(data.reads(), 1);
            assert.equal(runtime.variables.get('Saved').sqliteSource, undefined);
            runtime.execute(`Ready = Saved ${select}`);
            assert.deepEqual(totals(runtime.variables.get('Ready')), expected);
            assert.equal(data.reads(), 1);
            runtime.execute(`Later' = Groups ${select}
Statement = Later sql`);
            assert.equal(data.reads(), 1);
            data.db.exec('UPDATE items SET id = 12 WHERE id = 2');
            assert.deepEqual(totals(runtime.execute('Later array')), changed);
            assert.equal(data.reads(), 2);
            runtime.execute(`Retained = Saved ${select}`);
            assert.deepEqual(totals(runtime.variables.get('Retained')), expected);
            assert.equal(data.reads(), 2);
            data.balanced();
        });
    }

    test(`empty SQLite rollup retains one grand total (compilation=${compilation})`, { timeout: 10000 }, t => {
        const data = fixture(t);
        data.db.exec('DELETE FROM items');
        const runtime = new Interpreter(undefined, { io: data.io, compilation });
        t.after(() => runtime.dispose());
        runtime.execute(`use tables
use sequences
Db = ${JSON.stringify(data.path)} sqlite
Groups' = (Db .items) rollup by .name
Saved = Groups
Result = Saved select
 .n = count
 .total = .id sum
end`);
        assert.equal(data.reads(), 1);
        const result = runtime.variables.get('Result');
        assert.equal(result.items.length, 1);
        assert.deepEqual([...result.items[0].entries], [['n', 0n], ['total', 0n]]);
        data.balanced();
    });

    for (const file of ['003_recs.ra', '012_rollup.ra', '022_rolling.ra']) {
        test(`PostgreSQL Exercises ${file} preserves SQL pushdown (compilation=${compilation})`, { timeout: 10000 }, t => {
            const data = fixture(t);
            data.db.exec(`CREATE TABLE members(memid INTEGER, recommendedby INTEGER);
                INSERT INTO members VALUES (1, NULL), (2, 1), (3, 1), (4, 99);
                CREATE TABLE facilities(facid INTEGER, membercost REAL, guestcost REAL);
                INSERT INTO facilities VALUES (0, 2, 10), (1, 3, 20);
                CREATE TABLE bookings(facid INTEGER, memid INTEGER, starttime TEXT, slots INTEGER);
                INSERT INTO bookings VALUES
                    (0, 0, '2012-08-01 10:00:00', 2),
                    (0, 1, '2012-08-02 10:00:00', 3),
                    (1, 2, '2012-08-03 10:00:00', 1),
                    (0, 0, '2011-12-31 10:00:00', 100),
                    (1, 0, '2013-01-01 10:00:00', 100);`);
            const runtime = new Interpreter(undefined, { io: data.io, compilation });
            t.after(() => runtime.dispose());
            const output = data.path + '.csv';
            const source = readFileSync(new URL(`../../../demos/pgexercises/aggregates/${file}`, import.meta.url), 'utf8');
            runtime.executeProgram(parse(source), [data.path, output]);
            const csv = readFileSync(output, 'utf8').trimEnd();
            if (file === '003_recs.ra') {
                assert.equal(csv, 'recommendedby,count\n1,2');
            } else if (file === '012_rollup.ra') {
                assert.equal(csv, 'facid,month,slots\n0,8,5\n0,,5\n1,8,1\n1,,1\n,,6');
            } else {
                const [header, ...rows] = csv.split('\n');
                assert.equal(header, 'date,revenue');
                assert.equal(rows.length, 31);
                const daily = new Map([[1, 20], [2, 6], [3, 3]]);
                rows.forEach((row, index) => {
                    const [date, value] = row.split(',');
                    const day = index + 1;
                    assert.equal(date, `2012-08-${String(day).padStart(2, '0')}`);
                    const expected = [...daily].filter(([when]) => when <= day && when >= day - 14)
                        .reduce((sum, [, revenue]) => sum + revenue, 0) / 15;
                    assert.ok(Math.abs(Number(value) - expected) < 1e-12, `${date}: ${value} != ${expected}`);
                });
            }
            assert.equal(data.reads(), 1);
            data.balanced();
        });
    }

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
