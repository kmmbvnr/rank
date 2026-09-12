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
const joins = path.join(root, 'demos/pgexercises/joins');

const cost = 'CASE WHEN m.memid = 0 THEN b.slots*f.guestcost ELSE b.slots*f.membercost END';
const costFrom = 'FROM bookings b JOIN members m ON m.memid=b.memid '
    + 'JOIN facilities f ON f.facid=b.facid '
    + "WHERE b.starttime >= '2012-09-14' AND b.starttime < '2012-09-15'";
const costly = `SELECT m.firstname||' '||m.surname AS member, f.name AS facility, ${cost} AS cost `
    + `${costFrom} AND ${cost} > 30 ORDER BY cost DESC`;
const reference = [
    "SELECT b.starttime FROM bookings b JOIN members m ON m.memid=b.memid "
        + "WHERE m.firstname='David' AND m.surname='Farrell'",
    'SELECT b.starttime AS start, f.name FROM bookings b JOIN facilities f ON f.facid=b.facid '
        + "WHERE f.name IN ('Tennis Court 1','Tennis Court 2') "
        + "AND b.starttime >= '2012-09-21' AND b.starttime < '2012-09-22' ORDER BY b.starttime",
    'SELECT DISTINCT r.firstname, r.surname FROM members m '
        + 'JOIN members r ON r.memid=m.recommendedby ORDER BY r.surname,r.firstname',
    'SELECT m.firstname AS memfname, m.surname AS memsname, '
        + 'r.firstname AS recfname, r.surname AS recsname FROM members m '
        + 'LEFT JOIN members r ON r.memid=m.recommendedby ORDER BY m.surname,m.firstname',
    "SELECT DISTINCT m.firstname||' '||m.surname AS member, f.name AS facility "
        + 'FROM members m JOIN bookings b ON b.memid=m.memid '
        + 'JOIN facilities f ON f.facid=b.facid '
        + "WHERE f.name IN ('Tennis Court 1','Tennis Court 2') ORDER BY member,facility",
    costly,
    "SELECT DISTINCT m.firstname||' '||m.surname AS member, "
        + "(SELECT r.firstname||' '||r.surname FROM members r WHERE r.memid=m.recommendedby) "
        + 'AS recommender FROM members m ORDER BY member',
    `SELECT member, facility, cost FROM (SELECT m.firstname||' '||m.surname AS member, `
        + `f.name AS facility, ${cost} AS cost ${costFrom}) WHERE cost > 30 ORDER BY cost DESC`,
];

function makeDatabase(dbPath) {
    const db = new Database(dbPath);
    db.exec('CREATE TABLE facilities (facid INTEGER, name TEXT, membercost REAL, guestcost REAL); '
        + 'CREATE TABLE members (memid INTEGER, firstname TEXT, surname TEXT, recommendedby INTEGER); '
        + 'CREATE TABLE bookings (bookid INTEGER, facid INTEGER, memid INTEGER, starttime TEXT, slots INTEGER)');
    const facility = db.prepare('INSERT INTO facilities VALUES (?, ?, ?, ?)');
    for (const row of [
        [0, 'Tennis Court 1', 5, 25], [1, 'Tennis Court 2', 5, 25],
        [2, 'Badminton Court', 0, 15], [3, 'Massage Room', 35, 80],
    ]) facility.run(...row);
    const member = db.prepare('INSERT INTO members VALUES (?, ?, ?, ?)');
    for (const row of [
        [0, 'GUEST', 'GUEST', null], [1, 'David', 'Farrell', null],
        [2, 'Janice', 'Joplette', 1], [3, 'Darren', 'Smith', null],
        [4, 'Darren', 'Smith', null], [5, 'Anne', 'Baker', 3],
        [6, 'Tim', 'Rownam', 3], [7, 'Joan', 'Coplin', 4],
        [8, 'Anne', 'Baker', 1], [9, 'Nancy', 'Dare', 999],
    ]) member.run(...row);
    const booking = db.prepare('INSERT INTO bookings VALUES (?, ?, ?, ?, ?)');
    for (const row of [
        [0, 0, 1, '2012-09-21 08:00:00', 1],
        [1, 0, 1, '2012-09-21 08:00:00', 1],
        [2, 1, 1, '2012-09-21 09:00:00', 1],
        [3, 1, 0, '2012-09-21 10:00:00', 1],
        [4, 0, 5, '2012-09-21 11:00:00', 1],
        [5, 3, 0, '2012-09-14 08:00:00', 2],
        [6, 3, 5, '2012-09-14 09:00:00', 2],
        [7, 0, 0, '2012-09-14 10:00:00', 2],
        [8, 0, 1, '2012-09-14 11:00:00', 1],
        [9, 3, 0, '2012-09-15 00:00:00', 2],
        [10, 1, 2, '2012-09-21 00:00:00', 1],
        [11, 1, 2, '2012-09-22 00:00:00', 1],
        [12, 3, 0, '2012-09-14 00:00:00', 1],
    ]) booking.run(...row);
    return db;
}

function rowsFromCsv(csv) {
    return csv.trimEnd().split('\n').map(line => line.split(','));
}

test('all 8 PostgreSQL Exercises Joins programs match SQLite reference queries', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgexercises-joins-'));
    const dbPath = path.join(directory, 'club.sqlite3');
    const db = makeDatabase(dbPath);
    try {
        const programs = fs.readdirSync(joins).filter(name => /^\d{3}_.*\.ra$/.test(name)).sort();
        assert.equal(programs.length, reference.length);
        for (const [index, program] of programs.entries()) {
            await t.test(program, () => {
                assert.equal(Number(program.slice(0, 3)), index + 1);
                const output = path.join(directory, 'out.csv');
                const result = spawnSync(process.execPath, [cli, path.join(joins, program), dbPath, output], {
                    cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024,
                });
                assert.equal(result.status, 0, result.stderr);
                const actual = rowsFromCsv(fs.readFileSync(output, 'utf8'));
                const statement = db.prepare(reference[index]);
                const expected = [statement.columns().map(column => column.name),
                    ...statement.all().map(row => Object.values(row).map(value => value === null ? '' : String(value)))];
                assert.deepEqual(actual[0], expected[0]);
                if (index === 5 || index === 7) {
                    for (const rows of [actual, expected]) {
                        for (const row of rows.slice(1)) row[2] = String(Number(row[2]));
                    }
                }
                assert.deepEqual(actual.slice(1).sort(), expected.slice(1).sort());
                if ([1, 2, 3, 4, 6].includes(index)) {
                    const key = row => index === 1 ? row[0]
                        : index === 2 ? `${row[1]}\0${row[0]}`
                            : index === 3 ? `${row[1]}\0${row[0]}`
                                : row[0] + (index === 4 ? `\0${row[1]}` : '');
                    assert.deepEqual(actual.slice(1).map(key), expected.slice(1).map(key));
                }
                if (index === 5 || index === 7) {
                    const costs = actual.slice(1).map(row => Number(row[2]));
                    assert.deepEqual(costs, [...costs].sort((a, b) => b - a));
                }
            });
        }
    } finally {
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
