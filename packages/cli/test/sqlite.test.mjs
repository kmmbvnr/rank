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
