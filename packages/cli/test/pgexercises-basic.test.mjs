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
const basic = path.join(root, 'demos/pgexercises/basic');

const reference = [
    'SELECT * FROM facilities',
    'SELECT name, membercost FROM facilities',
    'SELECT * FROM facilities WHERE membercost > 0',
    'SELECT facid, name, membercost, monthlymaintenance FROM facilities '
        + 'WHERE membercost > 0 AND membercost < monthlymaintenance / 50.0',
    "SELECT * FROM facilities WHERE name LIKE '%Tennis%'",
    'SELECT * FROM facilities WHERE facid IN (1, 5)',
    "SELECT name, CASE WHEN monthlymaintenance > 100 THEN 'expensive' ELSE 'cheap' END AS cost "
        + 'FROM facilities',
    "SELECT memid, surname, firstname, joindate FROM members WHERE joindate >= '2012-09-01'",
    'SELECT DISTINCT surname FROM members ORDER BY surname LIMIT 10',
    'SELECT surname FROM members UNION SELECT name FROM facilities',
    'SELECT MAX(joindate) AS latest FROM members',
    'SELECT firstname, surname, joindate FROM members '
        + 'WHERE joindate = (SELECT MAX(joindate) FROM members)',
];

function makeDatabase(dbPath) {
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE facilities (
        facid INTEGER, name TEXT, membercost REAL, guestcost REAL,
        initialoutlay REAL, monthlymaintenance REAL
    ); CREATE TABLE members (
        memid INTEGER, surname TEXT, firstname TEXT, joindate TEXT
    )`);
    const facility = db.prepare('INSERT INTO facilities VALUES (?, ?, ?, ?, ?, ?)');
    for (const row of [
        [0, 'Tennis Court 1', 5, 25, 10000, 200],
        [1, 'Tennis Court 2', 5, 25, 8000, 200],
        [2, 'Badminton Court', 0, 15.5, 4000, 50],
        [3, 'Table Tennis', 0, 5, 320, 10],
        [4, 'Massage Room 1', 35, 80, 4000, 3000],
        [5, 'Massage Room 2', 35, 80, 4000, 3000],
        [6, 'Squash Court', 3.5, 17.5, 5000, 80],
        [7, 'tennis practice', 0, 5, 450, 15],
        [8, 'Pool Table', 0, 5, 400, 15],
    ]) facility.run(...row);
    const member = db.prepare('INSERT INTO members VALUES (?, ?, ?, ?)');
    for (const [index, surname] of [
        'Smith', 'Baker', 'Dare', 'Jones', 'Jones', 'Farrell',
        'GUEST', 'Mackenzie', 'Owen', 'Purview', 'Bader', 'Boothe',
        'Crumpet', 'Zed',
    ].entries()) {
        const date = index < 6 ? '2012-08-31 23:00:00'
            : index >= 12 ? '2012-09-26 18:08:45'
                : '2012-09-01 00:00:00';
        member.run(index, surname, `First${index}`, date);
    }
    return db;
}

test('all 12 PostgreSQL Exercises Basic programs match SQLite reference queries', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgexercises-'));
    const dbPath = path.join(directory, 'club.sqlite3');
    const db = makeDatabase(dbPath);
    try {
        const programs = fs.readdirSync(basic).filter(name => /^\d{3}_.*\.ra$/.test(name)).sort();
        assert.equal(programs.length, reference.length);
        for (const [index, program] of programs.entries()) {
            await t.test(program, () => {
                assert.equal(Number(program.slice(0, 3)), index + 1);
                const output = path.join(directory, 'out.csv');
                const result = spawnSync(process.execPath, [cli, path.join(basic, program), dbPath, output], {
                    cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024,
                });
                assert.equal(result.status, 0, result.stderr);
                const actual = fs.readFileSync(output, 'utf8').trimEnd().split('\n').map(line => line.split(','));
                const statement = db.prepare(reference[index]);
                const expected = [statement.columns().map(column => column.name),
                    ...statement.all().map(row => Object.values(row).map(value => value === null ? '' : String(value)))];
                assert.deepEqual(actual[0], expected[0]);
                if (index === 8) assert.deepEqual(actual, expected);
                else assert.deepEqual(actual.slice(1).sort(), expected.slice(1).sort());
            });
        }
    } finally {
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
