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
const examples = path.join(root, 'demos/pgexercises/aggregates');

const cases = [
    ['001_count.ra', 'SELECT COUNT(*) FROM facilities'],
    ['002_costly.ra', 'SELECT COUNT(*) FROM facilities WHERE guestcost >= 10'],
    ['007_booked.ra', 'SELECT COUNT(DISTINCT memid) FROM bookings'],
];

const grouped = [
    ['003_recs.ra', 'SELECT recommendedby, COUNT(*) AS count FROM members '
        + 'WHERE recommendedby IS NOT NULL GROUP BY recommendedby ORDER BY recommendedby'],
    ['004_slots.ra', 'SELECT facid, SUM(slots) AS slots FROM bookings '
        + 'GROUP BY facid ORDER BY facid'],
    ['005_sept.ra', 'SELECT facid, SUM(slots) AS slots FROM bookings '
        + "WHERE starttime >= '2012-09-01' AND starttime < '2012-10-01' "
        + 'GROUP BY facid ORDER BY slots'],
    ['006_months.ra', 'SELECT facid, CAST(strftime(\'%m\',starttime) AS INTEGER) AS month, '
        + 'SUM(slots) AS slots FROM bookings '
        + "WHERE starttime >= '2012-01-01' AND starttime < '2013-01-01' "
        + 'GROUP BY facid, month ORDER BY facid, month'],
    ['008_over1k.ra', 'SELECT facid, SUM(slots) AS slots FROM bookings '
        + 'GROUP BY facid HAVING SUM(slots) > 1000 ORDER BY facid'],
    ['009_rev.ra', 'SELECT f.name, SUM(b.slots * CASE WHEN b.memid = 0 '
        + 'THEN f.guestcost ELSE f.membercost END) AS revenue '
        + 'FROM bookings b JOIN facilities f ON b.facid = f.facid '
        + 'GROUP BY f.name ORDER BY revenue'],
    ['010_lowrev.ra', 'SELECT f.name, SUM(b.slots * CASE WHEN b.memid = 0 '
        + 'THEN f.guestcost ELSE f.membercost END) AS revenue '
        + 'FROM bookings b JOIN facilities f ON b.facid = f.facid '
        + 'GROUP BY f.name HAVING revenue < 1000 ORDER BY revenue'],
    ['011_top.ra', 'SELECT facid, SUM(slots) AS slots FROM bookings '
        + 'GROUP BY facid ORDER BY slots DESC LIMIT 1'],
    ['012_rollup.ra', 'WITH rows AS (SELECT facid, '
        + "CAST(strftime('%m',starttime) AS INTEGER) AS month, slots FROM bookings "
        + "WHERE starttime >= '2012-01-01' AND starttime < '2013-01-01'), "
        + 'totals AS (SELECT facid, month, SUM(slots) AS slots FROM rows '
        + 'GROUP BY facid, month UNION ALL '
        + 'SELECT facid, NULL, SUM(slots) FROM rows GROUP BY facid UNION ALL '
        + 'SELECT NULL, NULL, SUM(slots) FROM rows) '
        + 'SELECT * FROM totals ORDER BY facid IS NULL, facid, month IS NULL, month'],
    ['013_hours.ra', 'SELECT b.facid, f.name, SUM(b.slots / 2.0) AS hours '
        + 'FROM bookings b JOIN facilities f ON b.facid = f.facid '
        + 'GROUP BY b.facid, f.name ORDER BY b.facid'],
    ['014_first.ra', 'SELECT m.surname, m.firstname, m.memid, '
        + 'MIN(b.starttime) AS starttime FROM bookings b '
        + 'JOIN members m ON b.memid = m.memid '
        + "WHERE b.starttime >= '2012-09-01' "
        + 'GROUP BY m.surname, m.firstname, m.memid ORDER BY m.memid'],
    ['017_ties.ra', 'WITH totals AS (SELECT facid, SUM(slots) AS total '
        + 'FROM bookings GROUP BY facid) SELECT facid, total FROM totals '
        + 'WHERE total = (SELECT MAX(total) FROM totals)'],
];

function csvRows(file) {
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').map(line => line.split(','));
}

test('aggregate count programs match SQLite on empty and repeated data', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-aggregates-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE facilities (facid INTEGER, guestcost REAL); '
            + 'CREATE TABLE bookings (memid INTEGER)');
        for (const [phase, populate] of [['empty', false], ['filled', true]]) {
            if (populate) {
                db.exec('INSERT INTO facilities VALUES (1, 5), (2, 10), (3, 10.5); '
                    + 'INSERT INTO bookings VALUES (1), (1), (2), (0), (0)');
            }
            for (const [file, sql] of cases) {
                await t.test(`${phase}: ${file}`, () => {
                    const result = spawnSync(process.execPath,
                        [cli, path.join(examples, file), dbPath],
                        { cwd: root, encoding: 'utf8' });
                    assert.equal(result.status, 0, result.stderr);
                    assert.equal(result.stdout.trim(), String(db.prepare(sql).pluck().get()));
                });
            }
        }
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('member count accompanies every row in join-date order on SQLite and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-member-count-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE members (memid INTEGER, firstname TEXT, '
            + 'surname TEXT, joindate TEXT)');
        const oracle = 'SELECT COUNT(*) OVER () AS count, firstname, surname '
            + 'FROM members ORDER BY joindate';
        const file = path.join(examples, '015_members.ra');
        for (const filled of [false, true]) {
            if (filled) db.exec("INSERT INTO members VALUES "
                + "(2,'B','Late','2012-08-03'),"
                + "(0,'GUEST','GUEST','2012-07-01'),"
                + "(1,'A','Early','2012-07-03')");
            for (const storage of ['sqlite', 'array']) {
                let source = file;
                if (storage === 'array') {
                    const members = db.prepare('SELECT * FROM members').all();
                    const program = fs.readFileSync(file, 'utf8')
                        .replace('Db = DbPath sqlite',
                            `use json\nDb = ${JSON.stringify(JSON.stringify({ members }))} json`);
                    source = path.join(dir, 'array.ra');
                    fs.writeFileSync(source, program);
                }
                const result = spawnSync(process.execPath,
                    [cli, source, dbPath, output], { cwd: root, encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr);
                const expected = db.prepare(oracle).all()
                    .map(row => Object.values(row).map(String));
                assert.deepEqual(csvRows(output),
                    [['count', 'firstname', 'surname'], ...expected]);
            }
        }
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('numbered members match a SQLite window on SQLite and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-numbered-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE members (memid INTEGER, firstname TEXT, '
            + 'surname TEXT, joindate TEXT)');
        const oracle = 'SELECT ROW_NUMBER() OVER (ORDER BY joindate, memid) '
            + 'AS row_number, firstname, surname FROM members ORDER BY joindate, memid';
        const file = path.join(examples, '016_numbered.ra');
        for (const filled of [false, true]) {
            if (filled) db.exec("INSERT INTO members VALUES "
                + "(9,'Later','A','2012-08-03'),"
                + "(0,'GUEST','GUEST','2012-07-01'),"
                + "(5,'Tie','B','2012-08-03'),"
                + "(2,'Early','C','2012-07-03')");
            for (const storage of ['sqlite', 'array']) {
                let source = file;
                if (storage === 'array') {
                    const members = db.prepare('SELECT * FROM members').all();
                    const program = fs.readFileSync(file, 'utf8')
                        .replace('Db = DbPath sqlite',
                            `use json\nDb = ${JSON.stringify(JSON.stringify({ members }))} json`);
                    source = path.join(dir, 'array.ra');
                    fs.writeFileSync(source, program);
                }
                const result = spawnSync(process.execPath,
                    [cli, source, dbPath, output], { cwd: root, encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr);
                const expected = db.prepare(oracle).all()
                    .map(row => Object.values(row).map(String));
                assert.deepEqual(csvRows(output),
                    [['row_number', 'firstname', 'surname'], ...expected]);
            }
        }
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('rounded member hours and gap ranks match SQLite on views and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-ranked-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE members (memid INTEGER, firstname TEXT, surname TEXT); '
            + 'CREATE TABLE bookings (memid INTEGER, slots INTEGER)');
        const oracle = 'WITH hours AS (SELECT m.firstname, m.surname, '
            + '((SUM(b.slots)+10)/20)*10 AS hours FROM bookings b '
            + 'JOIN members m ON b.memid = m.memid GROUP BY m.memid), '
            + 'ranked AS (SELECT firstname, surname, hours, '
            + 'RANK() OVER (ORDER BY hours DESC) AS rank FROM hours) '
            + 'SELECT firstname, surname, hours, rank FROM ranked '
            + 'ORDER BY rank, surname, firstname';
        const file = path.join(examples, '018_ranks.ra');
        for (const filled of [false, true]) {
            if (filled) db.exec("INSERT INTO members VALUES "
                + "(0,'GUEST','GUEST'),(1,'A','Zed'),(2,'B','Young'),"
                + "(3,'C','Xavier'),(4,'D','Unused'); "
                + 'INSERT INTO bookings VALUES '
                + '(0,410),(1,390),(2,390),(3,290)');
            for (const storage of ['sqlite', 'array']) {
                if (!filled && storage === 'array') continue;
                let source = file;
                if (storage === 'array') {
                    const tables = Object.fromEntries(['members', 'bookings']
                        .map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
                    const program = fs.readFileSync(file, 'utf8')
                        .replace('Db = DbPath sqlite',
                            `use json\nDb = ${JSON.stringify(JSON.stringify(tables))} json`);
                    source = path.join(dir, 'array.ra');
                    fs.writeFileSync(source, program);
                }
                const result = spawnSync(process.execPath,
                    [cli, source, dbPath, output], { cwd: root, encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr);
                const expected = db.prepare(oracle).all().map(row =>
                    Object.values(row).map(String));
                assert.deepEqual(csvRows(output),
                    [['firstname', 'surname', 'hours', 'rank'], ...expected]);
            }
        }
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('top three facility ranks include ties on SQLite views and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-revenue-ranks-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE facilities (facid INTEGER, name TEXT, '
            + 'membercost INTEGER, guestcost INTEGER); '
            + 'CREATE TABLE bookings (facid INTEGER, memid INTEGER, slots INTEGER)');
        const oracle = 'WITH revenue AS (SELECT f.name, SUM(b.slots * '
            + 'CASE WHEN b.memid = 0 THEN f.guestcost ELSE f.membercost END) '
            + 'AS revenue FROM bookings b JOIN facilities f ON b.facid = f.facid '
            + 'GROUP BY f.name), ranked AS (SELECT name, '
            + 'RANK() OVER (ORDER BY revenue DESC) AS rank FROM revenue) '
            + 'SELECT name, rank FROM ranked WHERE rank <= 3 ORDER BY rank, name';
        const file = path.join(examples, '019_revtop.ra');
        for (const filled of [false, true]) {
            if (filled) db.exec("INSERT INTO facilities VALUES "
                + "(0,'A',10,20),(1,'B',10,20),(2,'C',10,20),"
                + "(3,'D',10,20),(4,'E',10,20); "
                + 'INSERT INTO bookings VALUES '
                + '(0,1,10),(1,0,5),(2,2,8),(3,0,4),(4,3,7)');
            for (const storage of ['sqlite', 'array']) {
                if (!filled && storage === 'array') continue;
                let source = file;
                if (storage === 'array') {
                    const tables = Object.fromEntries(['facilities', 'bookings']
                        .map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
                    const program = fs.readFileSync(file, 'utf8')
                        .replace('Db = DbPath sqlite',
                            `use json\nDb = ${JSON.stringify(JSON.stringify(tables))} json`);
                    source = path.join(dir, 'array.ra');
                    fs.writeFileSync(source, program);
                }
                const result = spawnSync(process.execPath,
                    [cli, source, dbPath, output], { cwd: root, encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr);
                const expected = db.prepare(oracle).all()
                    .map(row => Object.values(row).map(String));
                assert.deepEqual(csvRows(output), [['name', 'rank'], ...expected]);
                if (filled) assert.deepEqual(expected.map(row => row[1]), ['1', '1', '3', '3']);
            }
        }
        const inspect = path.join(dir, 'inspect.ra');
        fs.writeFileSync(inspect, fs.readFileSync(file, 'utf8')
            .replace('Result OutputPath csv',
                'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath,
            [cli, inspect, dbPath], { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /RANK\(\) OVER \(ORDER BY/);
        assert.match(plan.stdout, /WHERE .*rank.*<=/);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('facility revenue classes match NTILE on SQLite views and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-revenue-classes-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE facilities (facid INTEGER, name TEXT, '
            + 'membercost INTEGER, guestcost INTEGER); '
            + 'CREATE TABLE bookings (facid INTEGER, memid INTEGER, slots INTEGER)');
        const oracle = 'WITH revenue AS (SELECT f.name, SUM(b.slots * '
            + 'CASE WHEN b.memid = 0 THEN f.guestcost ELSE f.membercost END) '
            + 'AS revenue FROM bookings b JOIN facilities f ON b.facid = f.facid '
            + 'GROUP BY f.name), tiled AS (SELECT name, NTILE(3) OVER '
            + '(ORDER BY revenue DESC, name) AS bucket FROM revenue) '
            + "SELECT name, CASE bucket WHEN 1 THEN 'high' WHEN 2 THEN "
            + "'average' ELSE 'low' END AS revenue FROM tiled ORDER BY bucket, name";
        const file = path.join(examples, '020_classify.ra');
        for (const count of [0, 1, 2, 4, 5, 6, 7, 8, 9, 10]) {
            db.exec('DELETE FROM bookings; DELETE FROM facilities');
            const addFacility = db.prepare('INSERT INTO facilities VALUES (?, ?, ?, ?)');
            const addBooking = db.prepare('INSERT INTO bookings VALUES (?, ?, ?)');
            for (let index = 0; index < count; index++) {
                addFacility.run(index, `Facility ${index}`, index % 2 ? 1 : 2, 2);
                addBooking.run(index, index % 2, count - Math.floor(index / 2));
            }
            for (const storage of ['sqlite', 'array']) {
                if (!count && storage === 'array') continue;
                let source = file;
                if (storage === 'array') {
                    const tables = Object.fromEntries(['facilities', 'bookings']
                        .map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
                    const program = fs.readFileSync(file, 'utf8')
                        .replace('Db = DbPath sqlite',
                            `use json\nDb = ${JSON.stringify(JSON.stringify(tables))} json`);
                    source = path.join(dir, 'array.ra');
                    fs.writeFileSync(source, program);
                }
                const result = spawnSync(process.execPath,
                    [cli, source, dbPath, output], { cwd: root, encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr);
                const expected = db.prepare(oracle).all()
                    .map(row => Object.values(row).map(String));
                assert.deepEqual(csvRows(output), [['name', 'revenue'], ...expected]);
            }
        }
        const inspect = path.join(dir, 'inspect.ra');
        fs.writeFileSync(inspect, fs.readFileSync(file, 'utf8')
            .replace('Result OutputPath csv',
                'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath,
            [cli, inspect, dbPath], { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /ROW_NUMBER\(\) OVER \(ORDER BY/);
        assert.match(plan.stdout, /CASE WHEN/);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('facility payback matches SQLite arithmetic on views and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-payback-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE facilities (facid INTEGER, name TEXT, '
            + 'membercost REAL, guestcost REAL, initialoutlay REAL, '
            + 'monthlymaintenance REAL); '
            + 'CREATE TABLE bookings (facid INTEGER, memid INTEGER, slots INTEGER)');
        const oracle = 'SELECT MIN(f.name) AS name, '
            + 'MIN(f.initialoutlay) / (SUM(b.slots * CASE WHEN b.memid = 0 '
            + 'THEN f.guestcost ELSE f.membercost END) / 3.0 '
            + '- MIN(f.monthlymaintenance)) AS months '
            + 'FROM bookings b JOIN facilities f ON b.facid = f.facid '
            + 'GROUP BY f.facid ORDER BY name';
        const file = path.join(examples, '021_payback.ra');
        for (const filled of [false, true]) {
            if (filled) db.exec("INSERT INTO facilities VALUES "
                + "(1,'Court',10,20,100,5),(2,'Pool',2,8,75,3),"
                + "(3,'Court',6,12,90,2),(4,'Unused',1,2,50,1); "
                + 'INSERT INTO bookings VALUES '
                + '(1,0,3),(1,1,4),(2,0,5),(2,2,8),'
                + '(3,1,5),(3,0,4)');
            for (const storage of ['sqlite', 'array']) {
                if (!filled && storage === 'array') continue;
                let source = file;
                if (storage === 'array') {
                    const tables = Object.fromEntries(['facilities', 'bookings']
                        .map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
                    const program = fs.readFileSync(file, 'utf8')
                        .replace('Db = DbPath sqlite',
                            `use json\nDb = ${JSON.stringify(JSON.stringify(tables))} json`);
                    source = path.join(dir, 'array.ra');
                    fs.writeFileSync(source, program);
                }
                const result = spawnSync(process.execPath,
                    [cli, source, dbPath, output], { cwd: root, encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr);
                const expected = db.prepare(oracle).all();
                const actual = csvRows(output);
                assert.deepEqual(actual[0], ['name', 'months']);
                assert.equal(actual.length, expected.length + 1);
                actual.slice(1).forEach(([name, months], index) => {
                    assert.equal(name, expected[index].name);
                    assert.ok(Math.abs(Number(months) - expected[index].months) < 1e-12);
                });
            }
        }
        const inspect = path.join(dir, 'inspect.ra');
        fs.writeFileSync(inspect, fs.readFileSync(file, 'utf8')
            .replace('Result OutputPath csv',
                'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath,
            [cli, inspect, dbPath], { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /GROUP BY "facid"/);
        assert.match(plan.stdout, /1\.0 \* "revenue"/);
        assert.match(plan.stdout, /1\.0 \* "outlay"/);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('rolling daily revenue includes empty days on SQLite and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-rolling-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE facilities (facid INTEGER, guestcost REAL, membercost REAL); '
            + 'CREATE TABLE bookings (facid INTEGER, memid INTEGER, slots INTEGER, starttime TEXT); '
            + 'INSERT INTO facilities VALUES (1,10,4),(2,7,3)');
        const oracle = `WITH RECURSIVE days(date) AS (
            SELECT '2012-07-18' UNION ALL
            SELECT date(date, '+1 day') FROM days WHERE date < '2012-08-31'
        ), revenue AS (
            SELECT date(b.starttime) AS date,
                SUM(b.slots * CASE WHEN b.memid = 0 THEN f.guestcost
                    ELSE f.membercost END) AS revenue
            FROM bookings b JOIN facilities f ON b.facid = f.facid
            GROUP BY date(b.starttime)
        ), rolling AS (
            SELECT days.date,
                COALESCE(SUM(revenue.revenue) OVER
                    (ORDER BY days.date ROWS BETWEEN 14 PRECEDING AND CURRENT ROW), 0)
                    / 15.0 AS revenue
            FROM days LEFT JOIN revenue ON days.date = revenue.date
        ) SELECT * FROM rolling WHERE date >= '2012-08-01' ORDER BY date`;
        const file = path.join(examples, '022_rolling.ra');
        for (const filled of [false, true]) {
            if (filled) db.exec("INSERT INTO bookings VALUES "
                + "(1,0,2,'2012-07-17 12:00:00'),"
                + "(1,0,2,'2012-07-18 00:00:00'),"
                + "(1,1,3,'2012-07-31 23:59:59'),"
                + "(2,0,1,'2012-08-01 00:00:00'),"
                + "(1,1,2,'2012-08-01 23:59:59'),"
                + "(1,2,1,'2012-08-02 12:00:00'),"
                + "(2,0,2,'2012-08-31 12:00:00')");
            for (const storage of ['sqlite', 'array']) {
                if (!filled && storage === 'array') continue;
                let source = file;
                if (storage === 'array') {
                    const tables = Object.fromEntries(['facilities', 'bookings']
                        .map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
                    const program = fs.readFileSync(file, 'utf8')
                        .replace('Db = DbPath sqlite',
                            `use json\nDb = ${JSON.stringify(JSON.stringify(tables))} json`)
                        .replace('Days = Db Start End calendar',
                            'Days = Start End calendar');
                    source = path.join(dir, 'array.ra');
                    fs.writeFileSync(source, program);
                }
                const result = spawnSync(process.execPath,
                    [cli, source, dbPath, output], { cwd: root, encoding: 'utf8' });
                assert.equal(result.status, 0, result.stderr);
                const actual = csvRows(output);
                const expected = db.prepare(oracle).all();
                assert.deepEqual(actual[0], ['date', 'revenue']);
                assert.equal(actual.length, 32);
                actual.slice(1).forEach(([date, revenue], index) => {
                    assert.equal(date, expected[index].date);
                    assert.ok(Math.abs(Number(revenue) - expected[index].revenue) < 1e-12);
                });
            }
        }
        const inspect = path.join(dir, 'inspect.ra');
        fs.writeFileSync(inspect, fs.readFileSync(file, 'utf8')
            .replace('Result OutputPath csv', 'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath,
            [cli, inspect, dbPath], { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /WITH RECURSIVE days/);
        assert.match(plan.stdout, /SELECT \? WHERE \? <= \?/);
        assert.doesNotMatch(plan.stdout, /2012-07-18/);
        assert.match(plan.stdout, /date\("starttime"\)/);
        assert.match(plan.stdout, /ROWS BETWEEN 14 PRECEDING AND CURRENT ROW/);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('grouped aggregate programs match SQLite without reading source rows early', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-groups-'));
    const dbPath = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE members (memid INTEGER, recommendedby INTEGER, '
            + 'firstname TEXT, surname TEXT); '
            + 'CREATE TABLE facilities (facid INTEGER, name TEXT, membercost REAL, guestcost REAL); '
            + 'CREATE TABLE bookings (facid INTEGER, memid INTEGER, slots INTEGER, starttime TEXT); '
            + "INSERT INTO members VALUES (1,NULL,'A','Smith'),(2,1,'B','Jones'),"
            + "(3,1,'C','Smith'),(4,2,'D','Miller'),(5,NULL,'E','Jones'); "
            + "INSERT INTO facilities VALUES (0,'Court',5,20),(1,'Pool',0,10); "
            + "INSERT INTO bookings VALUES (0,1,2,'2012-08-31 00:00:00'),"
            + "(0,2,3,'2012-09-01 00:00:00'),(1,1,4,'2012-09-10 00:00:00'),"
            + "(0,3,5,'2012-09-30 00:00:00'),(1,2,6,'2012-10-01 00:00:00'),"
            + "(0,0,1100,'2012-09-12 00:00:00')");
        for (const [file, sql] of grouped) {
            for (const storage of ['sqlite', 'array']) {
                await t.test(`${file} (${storage})`, () => {
                    let source = path.join(examples, file);
                    if (storage === 'array') {
                        const tables = Object.fromEntries(['members', 'facilities', 'bookings']
                            .map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
                        const program = fs.readFileSync(source, 'utf8')
                            .replace('Db = DbPath sqlite',
                                `use json\nDb = ${JSON.stringify(JSON.stringify(tables))} json`);
                        source = path.join(dir, 'array.ra');
                        fs.writeFileSync(source, program);
                    }
                    const result = spawnSync(process.execPath,
                        [cli, source, dbPath, output],
                        { cwd: root, encoding: 'utf8' });
                    assert.equal(result.status, 0, result.stderr);
                    const expected = db.prepare(sql).all().map(row => Object.values(row)
                        .map(value => value === null ? '' : String(value)));
                    assert.deepEqual(csvRows(output).slice(1), expected);
                });
            }
        }
        const source = path.join(dir, 'inspect.ra');
        fs.writeFileSync(source, `use io\nuse numbers\nuse sequences\nuse tables\n`
            + `Db = ${JSON.stringify(dbPath)} sqlite\n`
            + 'R = Db .bookings\nG = R group by .facid\n'
            + 'S = G select\n  .visits = count\n  .slots = .slots sum\nend\n'
            + 'Q = S sql\nQ .text print\n');
        const result = spawnSync(process.execPath, [cli, source],
            { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /GROUP BY "facid"/);
        assert.match(result.stdout, /SUM\("slots"\)/);
        assert.match(result.stdout, /COUNT\(\*\)/);
        const mixed = path.join(dir, 'mixed.ra');
        fs.writeFileSync(mixed, `use io\nuse numbers\nuse sequences\nuse stats\nuse tables\n`
            + `use cli\nargument DbPath path\nargument OutputPath path\n`
            + 'Db = DbPath sqlite\nR = Db .bookings\nG = R group by .facid\n'
            + 'S = G select\n  .visits = count\n  .present = .slots count\n'
            + '  .slots = .slots sum\n  .low = .slots min\n'
            + '  .high = .slots max\n  .average = .slots mean\nend\n'
            + 'S = S sort by .facid\nS OutputPath csv\n');
        const mixedResult = spawnSync(process.execPath,
            [cli, mixed, dbPath, output], { cwd: root, encoding: 'utf8' });
        assert.equal(mixedResult.status, 0, mixedResult.stderr);
        const mixedSql = 'SELECT facid, COUNT(*) AS visits, COUNT(slots) AS present, '
            + 'SUM(slots) AS slots, MIN(slots) AS low, MAX(slots) AS high, '
            + 'AVG(slots) AS average FROM bookings GROUP BY facid ORDER BY facid';
        assert.deepEqual(csvRows(output).slice(1), db.prepare(mixedSql).all()
            .map(row => Object.values(row).map(String)));
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('rollup keeps real NULL keys distinct and repeats bound source parameters', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-rollup-'));
    const dbPath = path.join(dir, 'facts.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE facts (facid INTEGER, month INTEGER, slots INTEGER); '
            + 'INSERT INTO facts VALUES (1,NULL,3),(1,7,2),(2,7,4)');
        const body = 'R = Db .facts\nR = R filter .slots greater 1\n'
            + 'G = R rollup by .facid .month\nTotals = G select\n'
            + '  .visits = count\n  .slots = .slots sum\nend\n'
            + 'Totals = Totals sort by .facid .month .slots\n'
            + 'Totals OutputPath csv\n';
        const expected = [
            ['facid', 'month', 'visits', 'slots'],
            ['1', '7', '1', '2'], ['1', '', '1', '3'],
            ['1', '', '2', '5'], ['2', '7', '1', '4'],
            ['2', '', '1', '4'], ['', '', '3', '9'],
        ];
        for (const storage of ['sqlite', 'array']) {
            const source = path.join(dir, `${storage}.ra`);
            const setup = storage === 'sqlite'
                ? 'Db = DbPath sqlite\n'
                : `use json\nDb = ${JSON.stringify(JSON.stringify({
                    facts: db.prepare('SELECT * FROM facts').all().map(row =>
                        Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null))),
                }))} json\n`;
            const inspect = storage === 'sqlite'
                ? 'Q = Totals sql\nQ .params len print\nQ .text print\n' : '';
            fs.writeFileSync(source, 'use cli\nuse io\nuse numbers\nuse sequences\nuse tables\n'
                + 'argument DbPath path\nargument OutputPath path\n'
                + setup + body.replace('Totals OutputPath csv\n', inspect + 'Totals OutputPath csv\n'));
            const result = spawnSync(process.execPath,
                [cli, source, dbPath, output], { cwd: root, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(csvRows(output), expected);
            if (storage === 'sqlite') {
                assert.match(result.stdout, /^3\n/);
                assert.match(result.stdout, /UNION ALL/);
            }
        }
        db.exec('DELETE FROM facts');
        const empty = spawnSync(process.execPath,
            [cli, path.join(dir, 'sqlite.ra'), dbPath, output],
            { cwd: root, encoding: 'utf8' });
        assert.equal(empty.status, 0, empty.stderr);
        assert.deepEqual(csvRows(output), [
            ['facid', 'month', 'visits', 'slots'], ['', '', '0', '0'],
        ]);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
