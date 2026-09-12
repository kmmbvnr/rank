import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import test from 'node:test';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

function fixture(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-sqlite-'));
    const dbPath = path.join(directory, 'club.sqlite3');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE facilities (
        facid INTEGER, name TEXT, membercost REAL, guestcost REAL,
        initialoutlay INTEGER, monthlymaintenance INTEGER
    )`);
    db.prepare('INSERT INTO facilities VALUES (?, ?, ?, ?, ?, ?)')
        .run(0, 'Tennis Court 1', 5, 25, 10000, 200);
    db.prepare('INSERT INTO facilities VALUES (?, ?, ?, ?, ?, ?)')
        .run(1, "O'Brien Court", 0, 15.5, 8000, null);
    db.close();
    try { return run(directory, dbPath); }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function runSource(directory, source) {
    const file = path.join(directory, 'program.ra');
    fs.writeFileSync(file, source);
    return spawnSync(process.execPath, [cli, file], {
        cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024,
    });
}

test('PostgreSQL Exercises basic 1 reads every facility column from SQLite', () => fixture((directory, dbPath) => {
    const output = path.join(directory, 'result.csv');
    const result = spawnSync(process.execPath, [cli,
        path.join(root, 'demos/pgexercises/basic/001_select_all.ra'), dbPath, output,
    ], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const lines = fs.readFileSync(output, 'utf8').trimEnd().split('\n');
    assert.equal(lines[0], 'facid,name,membercost,guestcost,initialoutlay,monthlymaintenance');
    assert.deepEqual(lines.slice(1).sort(), [
        '0,Tennis Court 1,5,25,10000,200',
        "1,O'Brien Court,0,15.5,8000,",
    ]);
}));

test('SQLite SQL inspection, EXPLAIN and bound raw query share the same plan', () => fixture((directory, dbPath) => {
    const result = runSource(directory, `use io\nuse sequences\nuse tables\nDb = ${JSON.stringify(dbPath)} sqlite\n`
        + `Facilities = Db .facilities\nStatement = Facilities sql\n`
        + `Statement .text print\nStatement .params len print\n`
        + `Text = "SELECT name FROM facilities WHERE name = ?"\n`
        + `Params = array "O'Brien Court"\n`
        + `Selected = Db Text Params sqlquery\n`
        + `Query = Selected sql\nQuery .text print\n`
        + `Plan = Selected explain\nPlan len print\n`
        + `Rows = Selected array\nRows .name print\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, [
        'SELECT * FROM "facilities"', '0',
        'SELECT name FROM facilities WHERE name = ?', '1', "O'Brien Court", '',
    ].join('\n'));
}));

test('raw SQL rejects missing bindings and writes', () => fixture((directory, dbPath) => {
    for (const [query, expected] of [
        ['SELECT * FROM facilities WHERE facid = ?', 'SQLite query failed'],
        ['DELETE FROM facilities', 'sqlquery expects one SELECT'],
    ]) {
        const result = runSource(directory, `use tables\nDb = ${JSON.stringify(dbPath)} sqlite\n`
            + `Db ${JSON.stringify(query)} (array shape 0 pad 0) sqlquery\n`);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, new RegExp(expected));
    }
    const db = new Database(dbPath, { readonly: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM facilities').get().n, 2);
    db.close();
}));

test('raw SQL binds text as data even when it looks like SQL', () => fixture((directory, dbPath) => {
    const result = runSource(directory, `use io\nuse sequences\nuse tables\n`
        + `Db = ${JSON.stringify(dbPath)} sqlite\n`
        + `Text = "SELECT name FROM facilities WHERE name = ?"\n`
        + `Params = array "O'Brien Court' OR 1=1 --"\n`
        + `Rows = Db Text Params sqlquery array\nRows len print\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '0\n');
}));

test('SQLite source rejects a missing database without creating it', () => fixture((directory) => {
    const missing = path.join(directory, 'missing.sqlite3');
    const result = runSource(directory, `use tables\n${JSON.stringify(missing)} sqlite\n`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SQLite open failed/);
    assert.equal(fs.existsSync(missing), false);
}));

test('Rank table projection, masks, joins, distinct and sort compose into SQL', () => fixture((directory, dbPath) => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE members (memid INTEGER, firstname TEXT, surname TEXT); '
        + 'CREATE TABLE bookings (bookid INTEGER, memid INTEGER, starttime TEXT)');
    for (const row of [[1, 'David', 'Farrell'], [2, 'David', 'Jones'], [3, 'Anne', 'Baker']]) {
        db.prepare('INSERT INTO members VALUES (?, ?, ?)').run(...row);
    }
    for (const row of [[1, 1, '2012-09-21'], [2, 1, '2012-09-21'],
        [3, 2, '2012-09-22'], [4, 3, '2012-09-23']]) {
        db.prepare('INSERT INTO bookings VALUES (?, ?, ?)').run(...row);
    }
    db.close();
    const output = path.join(directory, 'result.csv');
    const result = runSource(directory, `use io\nuse sequences\nuse tables\n`
        + `Db = ${JSON.stringify(dbPath)} sqlite\n`
        + 'Bookings = (Db .bookings) (array .memid .starttime)\n'
        + 'Members = (Db .members) (array .memid .firstname .surname)\n'
        + 'Selected = Members (Members .firstname equal "David")\n'
        + 'Joined = Bookings Selected innerjoin by .memid\n'
        + 'Rows = (Joined (Joined .surname equal "Farrell")) (array .starttime .surname)\n'
        + 'Result = (Rows unique) sort by .starttime .surname\n'
        + 'Query = Result sql\nQuery .text print\nQuery .params print\n'
        + `Result ${JSON.stringify(output)} csv\nResult .surname print\n`);
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trimEnd().split('\n');
    assert.match(lines[0], /SELECT \* FROM \(SELECT DISTINCT/);
    assert.match(lines[0], /INNER JOIN/);
    assert.match(lines[0], /ORDER BY "starttime", "surname"/);
    assert.match(lines[0], /\?/);
    assert.doesNotMatch(lines[0], /David|Farrell/);
    assert.equal(lines[1], 'David David David Farrell Farrell Farrell');
    assert.equal(lines[2], 'Farrell');
    assert.equal(fs.readFileSync(output, 'utf8'), 'starttime,surname\n2012-09-21,Farrell\n');
}));

test('SQLite equality keeps Rank numeric and text keys distinct', () => fixture((directory, dbPath) => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE ints (k INTEGER); CREATE TABLE reals (k REAL); '
        + 'CREATE TABLE texts (k TEXT); '
        + "INSERT INTO ints VALUES (1); INSERT INTO reals VALUES (1.0); INSERT INTO texts VALUES ('1')");
    db.close();
    const result = runSource(directory, `use io\nuse sequences\nuse tables\n`
        + `Db = ${JSON.stringify(dbPath)} sqlite\n`
        + 'Ints = Db .ints\nReals = Db .reals\nTexts = Db .texts\n'
        + '(Ints Reals innerjoin by .k) len print\n'
        + '(Ints Texts innerjoin by .k) len print\n'
        + '(Ints (Ints .k equal "1")) len print\n'
        + '(Ints (Ints .k equal 1)) len print\n');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '1\n0\n0\n1\n');
}));

test('left join keeps absent right columns in an empty-first-row CSV', () => fixture((directory, dbPath) => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE requests (requestid INTEGER, recommendedby INTEGER); '
        + 'CREATE TABLE recommenders (memid INTEGER, recname TEXT); '
        + "INSERT INTO requests VALUES (1, NULL), (2, 7); "
        + "INSERT INTO recommenders VALUES (7, 'Anne')");
    db.close();
    const output = path.join(directory, 'joined.csv');
    const result = runSource(directory, `use tables\nDb = ${JSON.stringify(dbPath)} sqlite\n`
        + 'Requests = Db .requests\nRecs = Db .recommenders\n'
        + 'Joined = Requests Recs leftjoin on .recommendedby equal .memid\n'
        + 'Result = Joined (array .requestid .recname)\n'
        + `Result ${JSON.stringify(output)} csv\n`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(output, 'utf8'), 'requestid,recname\n1,\n2,Anne\n');
}));

test('aliased self join stays in SQLite and exposes nested fields', () => fixture((directory, dbPath) => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE members (memid INTEGER, firstname TEXT, recommendedby INTEGER); '
        + "INSERT INTO members VALUES (1, 'Ada', NULL), (2, 'Bea', 1)");
    db.close();
    const result = runSource(directory, `use io\nuse sequences\nuse tables\nDb = ${JSON.stringify(dbPath)} sqlite\n`
        + 'M = Db .members alias .m\nR = Db .members alias .r\n'
        + 'J = M R leftjoin on\n  .recommendedby equal .memid\n'
        + 'Q = J sql\nQ .text print\n'
        + 'F = J (J .m .firstname equal "Bea")\nF len print\nRows = J array\n'
        + 'Rows .m .firstname print\nRF = Rows .r .firstname pad ""\nRF print\n');
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trimEnd().split('\n');
    assert.match(lines[0], /LEFT JOIN/);
    assert.match(lines[0], /AS "m\.firstname"/);
    assert.match(lines[0], /AS "r\.firstname"/);
    assert.equal(lines[1], '1');
    assert.equal(lines[2], 'Ada Bea');
    assert.equal(lines[3], ' Ada');
}));

test('TPC-H Q6 Rank operations execute a bound SQLite aggregate', () => fixture((directory, dbPath) => {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE lineitem (l_shipdate TEXT, l_discount REAL, '
        + 'l_quantity REAL, l_extendedprice REAL)');
    for (const row of [
        ['1994-01-01', 0.05, 10, 100], ['1994-08-02', 0.06, 5, 200],
        ['1993-01-01', 0.06, 5, 1000], ['1994-01-01', 0.08, 5, 1000],
        ['1994-01-01', 0.06, 24, 1000], ['1995-01-01', 0.05, 1, 1000],
    ]) db.prepare('INSERT INTO lineitem VALUES (?, ?, ?, ?)').run(...row);
    const expected = db.prepare('SELECT SUM(l_extendedprice*l_discount) AS revenue FROM lineitem '
        + "WHERE l_shipdate >= '1994-01-01' AND l_shipdate < '1995-01-01' "
        + 'AND l_discount >= 0.05 AND l_discount <= 0.07 AND l_quantity < 24').get().revenue;
    db.close();
    const result = spawnSync(process.execPath, [cli,
        path.join(root, 'demos/tpch/001_q6_sqlite.ra'), dbPath,
    ], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Number(result.stdout.trim()), expected);
}));
