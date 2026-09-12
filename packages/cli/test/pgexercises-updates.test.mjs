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
const updates = path.join(root, 'demos/pgexercises/updates');

const reference = [
    "INSERT INTO facilities VALUES (9, 'Spa', 20, 30, 100000, 800)",
    "INSERT INTO facilities VALUES (9, 'Spa', 20, 30, 100000, 800), "
        + "(10, 'Squash Court 2', 3.5, 17.5, 5000, 80)",
    "INSERT INTO facilities SELECT MAX(facid)+1, 'Spa', 20, 30, 100000, 800 FROM facilities",
    'UPDATE facilities SET initialoutlay = 10000 WHERE facid = 1',
    'UPDATE facilities SET membercost = 6, guestcost = 30 WHERE facid IN (0, 1)',
    'UPDATE facilities SET membercost = '
        + '(SELECT membercost * 1.1 FROM facilities WHERE facid = 0), '
        + 'guestcost = (SELECT guestcost * 1.1 FROM facilities WHERE facid = 0) '
        + 'WHERE facid = 1',
    'DELETE FROM bookings',
    'DELETE FROM members WHERE memid = 37',
    'DELETE FROM members WHERE memid NOT IN (SELECT memid FROM bookings)',
];

function makeDatabase(dbPath) {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE facilities (facid INTEGER PRIMARY KEY, name TEXT, '
        + 'membercost REAL, guestcost REAL, initialoutlay REAL, monthlymaintenance REAL); '
        + 'CREATE TABLE members (memid INTEGER PRIMARY KEY, firstname TEXT, surname TEXT); '
        + 'CREATE TABLE bookings (bookid INTEGER PRIMARY KEY, facid INTEGER, memid INTEGER)');
    const facility = db.prepare('INSERT INTO facilities VALUES (?, ?, ?, ?, ?, ?)');
    for (const row of [
        [0, 'Tennis Court 1', 5, 25, 10000, 200],
        [1, 'Tennis Court 2', 5, 25, 8000, 200],
        [2, 'Badminton Court', 0, 15.5, 4000, 50],
        [3, 'Table Tennis', 0, 5, 320, 10],
        [4, 'Massage Room 1', 35, 80, 4000, 3000],
        [5, 'Massage Room 2', 35, 80, 4000, 3000],
        [6, 'Squash Court', 3.5, 17.5, 5000, 80],
        [7, 'Snooker Table', 0, 5, 450, 15],
        [8, 'Pool Table', 0, 5, 400, 15],
    ]) facility.run(...row);
    const member = db.prepare('INSERT INTO members VALUES (?, ?, ?)');
    for (const row of [
        [0, 'GUEST', 'GUEST'], [1, 'Darren', 'Smith'],
        [2, 'Tracy', 'Smith'], [37, 'Betty', 'Unused'],
        [38, 'Alice', 'Unused'],
    ]) member.run(...row);
    const booking = db.prepare('INSERT INTO bookings VALUES (?, ?, ?)');
    for (const row of [[0, 0, 0], [1, 1, 1], [2, 1, 1], [3, 2, 2]]) {
        booking.run(...row);
    }
    return db;
}

function snapshot(db) {
    return Object.fromEntries(['facilities', 'members', 'bookings'].map(name =>
        [name, db.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]));
}

test('all 9 Updates programs change SQLite like the reference SQL', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgexercises-updates-'));
    try {
        const programs = fs.readdirSync(updates)
            .filter(name => /^\d{3}_.*\.ra$/.test(name)).sort();
        assert.equal(programs.length, reference.length);
        for (const [index, program] of programs.entries()) {
            await t.test(program, () => {
                assert.equal(Number(program.slice(0, 3)), index + 1);
                const actualPath = path.join(directory, 'actual.sqlite3');
                const expectedPath = path.join(directory, 'expected.sqlite3');
                const actualDb = makeDatabase(actualPath);
                const expectedDb = makeDatabase(expectedPath);
                try {
                    expectedDb.exec(reference[index]);
                    const result = spawnSync(process.execPath,
                        [cli, path.join(updates, program), actualPath],
                        { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
                    assert.equal(result.status, 0, result.stderr);
                    assert.deepEqual(snapshot(actualDb), snapshot(expectedDb));
                } finally {
                    actualDb.close();
                    expectedDb.close();
                    fs.rmSync(actualPath, { force: true });
                    fs.rmSync(expectedPath, { force: true });
                }
            });
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('sql and explain inspect writes without changing the database', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-sqlite-preview-'));
    const dbPath = path.join(directory, 'club.sqlite3');
    const source = path.join(directory, 'preview.ra');
    const db = makeDatabase(dbPath);
    const before = snapshot(db);
    try {
        fs.writeFileSync(source, `use cli
use io
use sequences
use tables
argument DbPath path
Db = DbPath sqlite
F = Db .facilities
Spa = record
  .facid = 9
  .name = "Spa"
end
I = sql F insert Spa
I .text print
I .params print
P = explain F insert Spa
P len print
T = F filter .facid equal 1
U = sql T update
  .initialoutlay = 10000
end
U .text print
D = explain T delete
D len print
`);
        const result = spawnSync(process.execPath, [cli, source, dbPath],
            { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /INSERT INTO "facilities"/);
        assert.match(result.stdout, /UPDATE "facilities"/);
        assert.doesNotMatch(result.stdout, /INSERT INTO.*Spa/);
        assert.deepEqual(snapshot(db), before);
    } finally {
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('filtered update reads the old row and insert binds quoted text', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-sqlite-write-'));
    const dbPath = path.join(directory, 'club.sqlite3');
    const source = path.join(directory, 'write.ra');
    const db = makeDatabase(dbPath);
    try {
        fs.writeFileSync(source, `use cli
use tables
argument DbPath path
Db = DbPath sqlite
F = Db .facilities
T = F filter .facid equal 1
T update
  .membercost = .membercost * 1.1
end
New = record
  .facid = 9
  .name = "O'Neil"
end
F insert New
`);
        const result = spawnSync(process.execPath, [cli, source, dbPath],
            { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(db.prepare('SELECT membercost FROM facilities WHERE facid = 0').get().membercost, 5);
        assert.equal(db.prepare('SELECT membercost FROM facilities WHERE facid = 1').get().membercost, 5.5);
        assert.equal(db.prepare('SELECT name FROM facilities WHERE facid = 9').get().name, "O'Neil");
    } finally {
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
