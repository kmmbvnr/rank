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
const directory = path.join(root, 'demos/pgexercises/date');

function run(name, ...args) {
    const result = spawnSync(process.execPath,
        [cli, path.join(directory, name), ...args],
        { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

test('date literals and components match the official examples', () => {
    assert.equal(run('001_timestamp.ra'), '2012-08-31 01:00:00');
    assert.equal(run('002_interval.ra'), '32 days');
    assert.equal(run('004_day.ra'), '31');
    assert.equal(run('005_seconds.ra'), '169200');
    assert.equal(run('007_remaining.ra'), '19 days');
});

test('date-to-datetime cast stays in SQL and preserves bound timestamps', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgdate-'));
    const dbPath = path.join(temporary, 'club.sqlite3');
    const output = path.join(temporary, 'remaining.csv');
    const script = path.join(temporary, 'remaining.ra');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE moments (time TEXT)');
        const insert = db.prepare('INSERT INTO moments VALUES (?)');
        insert.run('2012-02-11 01:00:00');
        insert.run('2012-02-29 23:59:59');
        const program = [
            'use cli', 'use dates', 'use tables',
            'argument DbPath path', 'argument OutputPath path',
            'Db = DbPath sqlite', 'M = Db .moments',
            'Moment = M .time datetime',
            'Today = Moment date datetime',
            'Next = Moment nextmonth',
            'Remaining = Next - Today',
            'Bound = "2012-02-11" date datetime',
            'Since = Today - Bound',
            'Result = M select',
            '  .today = Today',
            '  .remaining = Remaining seconds',
            '  .since = Since seconds',
            'end',
            'Result OutputPath csv',
        ].join('\n');
        fs.writeFileSync(script, program);
        const result = spawnSync(process.execPath,
            [cli, script, dbPath, output], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const expected = db.prepare(`SELECT datetime(date(time)) AS today,
            unixepoch(datetime(time, 'start of month', '+1 month'))
                - unixepoch(datetime(date(time))) AS remaining,
            unixepoch(datetime(date(time))) - unixepoch(?) AS since
            FROM moments`).all('2012-02-11 00:00:00');
        assert.deepEqual(fs.readFileSync(output, 'utf8').trim().split('\n'),
            ['today,remaining,since',
                ...expected.map(row => `${row.today},${row.remaining},${row.since}`)]);
        fs.writeFileSync(script, program.replace('Result OutputPath csv',
            'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath,
            [cli, script, dbPath, output], { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /datetime\(date\("time"\)\)/);
        assert.match(plan.stdout, /unixepoch\(\?\)/);
        assert.doesNotMatch(plan.stdout, /2012-02-11 00:00:00/);
    } finally {
        db.close();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

test('October calendar matches a recursive SQLite oracle', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgdate-'));
    const dbPath = path.join(temporary, 'club.sqlite3');
    const output = path.join(temporary, 'calendar.csv');
    const db = new Database(dbPath);
    try {
        const expected = db.prepare(`WITH RECURSIVE days(ts) AS (
            SELECT date('2012-10-01')
            UNION ALL SELECT date(ts, '+1 day') FROM days
            WHERE ts < date('2012-10-31')
        ) SELECT ts FROM days`).all().map(row => row.ts);
        run('003_calendar.ra', dbPath, output);
        const actual = fs.readFileSync(output, 'utf8').trim().split('\n');
        assert.deepEqual(actual, ['ts', ...expected]);
        assert.equal(expected.length, 31);
        const source = fs.readFileSync(path.join(directory, '003_calendar.ra'), 'utf8');
        const inspect = path.join(temporary, 'inspect.ra');
        fs.writeFileSync(inspect, source.replace('Result OutputPath csv',
            'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath, [cli, inspect, dbPath],
            { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /WITH RECURSIVE days/);
        assert.match(plan.stdout, /SELECT \? WHERE \? <= \?/);
        assert.doesNotMatch(plan.stdout, /2012-10-01/);
    } finally {
        db.close();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

test('datetime differences stay in SQL with bound timestamp operands', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgdate-'));
    const dbPath = path.join(temporary, 'club.sqlite3');
    const output = path.join(temporary, 'durations.csv');
    const script = path.join(temporary, 'durations.ra');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE events (started TEXT, ended TEXT)');
        const insert = db.prepare('INSERT INTO events VALUES (?, ?)');
        insert.run('2024-02-28 23:59:59', '2024-03-01 00:00:01');
        insert.run('2024-03-01 00:00:00', '2024-02-29 23:59:59');
        const program = [
            'use cli', 'use dates', 'use tables',
            'argument DbPath path', 'argument OutputPath path',
            'Db = DbPath sqlite', 'E = Db .events',
            'Start = E .started datetime',
            'End = E .ended datetime',
            'Elapsed = End - Start',
            'Baseline = "2024-02-28 00:00:00" datetime',
            'Since = End - Baseline',
            'Result = E select',
            '  .elapsed = Elapsed seconds',
            '  .since = Since seconds',
            'end',
            'Result OutputPath csv',
        ].join('\n');
        fs.writeFileSync(script, program);
        const result = spawnSync(process.execPath,
            [cli, script, dbPath, output], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const actual = fs.readFileSync(output, 'utf8').trim().split('\n');
        const expected = db.prepare(`SELECT
            unixepoch(ended) - unixepoch(started) AS elapsed,
            unixepoch(ended) - unixepoch(?) AS since
            FROM events`).all('2024-02-28 00:00:00');
        assert.deepEqual(actual, ['elapsed,since',
            ...expected.map(row => `${row.elapsed},${row.since}`)]);
        fs.writeFileSync(script, program.replace('Result OutputPath csv',
            'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath, [cli, script, dbPath, output],
            { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /unixepoch\("ended"\) - unixepoch\("started"\)/);
        assert.match(plan.stdout, /unixepoch\(\?\)/);
        assert.doesNotMatch(plan.stdout, /2024-02-28 00:00:00/);
    } finally {
        db.close();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

test('2012 month lengths match a recursive SQLite oracle', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgdate-'));
    const output = path.join(temporary, 'months.csv');
    const db = new Database(':memory:');
    try {
        run('006_monthlen.ra', output);
        const actual = fs.readFileSync(output, 'utf8').trim().split('\n');
        const expected = db.prepare(`WITH RECURSIVE months(first) AS (
            SELECT '2012-01-01'
            UNION ALL SELECT date(first, '+1 month') FROM months
            WHERE first < '2012-12-01'
        ) SELECT CAST(strftime('%m', first) AS INTEGER) AS month,
            CAST(julianday(date(first, '+1 month')) - julianday(first)
                AS INTEGER) AS days FROM months`).all();
        assert.deepEqual(actual, ['month,length',
            ...expected.map(row => `${row.month},${row.days} days`)]);
        assert.equal(expected.length, 12);
    } finally {
        db.close();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

test('month boundaries on SQLite columns stay in a lazy SQL plan', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgdate-'));
    const dbPath = path.join(temporary, 'club.sqlite3');
    const output = path.join(temporary, 'months.csv');
    const script = path.join(temporary, 'months.ra');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE moments (time TEXT)');
        const insert = db.prepare('INSERT INTO moments VALUES (?)');
        insert.run('2012-02-29 23:59:59');
        insert.run('2012-12-31 08:30:00');
        const program = [
            'use cli', 'use dates', 'use tables',
            'argument DbPath path', 'argument OutputPath path',
            'Db = DbPath sqlite', 'M = Db .moments',
            'Time = M .time datetime',
            'First = Time monthstart',
            'Next = Time nextmonth',
            'Result = M select',
            '  .first = First',
            '  .next = Next',
            'end',
            'Result OutputPath csv',
        ].join('\n');
        fs.writeFileSync(script, program);
        const result = spawnSync(process.execPath,
            [cli, script, dbPath, output], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(fs.readFileSync(output, 'utf8').trim().split('\n'), [
            'first,next',
            '2012-02-01 00:00:00,2012-03-01 00:00:00',
            '2012-12-01 00:00:00,2013-01-01 00:00:00',
        ]);
        fs.writeFileSync(script, program.replace('Result OutputPath csv',
            'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath, [cli, script, dbPath, output],
            { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /datetime\("time", 'start of month'\)/);
        assert.match(plan.stdout, /datetime\("time", 'start of month', '\+1 month'\)/);
    } finally {
        db.close();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

test('monthly booking counts match SQL on SQLite and arrays', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgdate-'));
    const dbPath = path.join(temporary, 'club.sqlite3');
    const csvPath = path.join(temporary, 'bookings.csv');
    const output = path.join(temporary, 'monthly.csv');
    const arrayScript = path.join(temporary, 'monthly-array.ra');
    const inspect = path.join(temporary, 'inspect.ra');
    const source = fs.readFileSync(path.join(directory, '009_monthly.ra'), 'utf8');
    const db = new Database(dbPath);
    try {
        db.exec('CREATE TABLE bookings (starttime TEXT)');
        const dates = [
            '2012-07-31 23:30:00', '2012-07-01 08:00:00',
            '2012-08-01 00:00:00', '2013-01-01 15:30:00',
        ];
        const insert = db.prepare('INSERT INTO bookings VALUES (?)');
        for (const date of dates) insert.run(date);
        fs.writeFileSync(csvPath, `starttime\n${dates.join('\n')}\n`);
        const oracle = `SELECT datetime(starttime, 'start of month') AS month,
            COUNT(*) AS count FROM bookings GROUP BY month ORDER BY month`;
        const expected = ['month,count', ...db.prepare(oracle).all()
            .map(row => `${row.month},${row.count}`)];
        assert.deepEqual(expected, [
            'month,count',
            '2012-07-01 00:00:00,2',
            '2012-08-01 00:00:00,1',
            '2013-01-01 00:00:00,1',
        ]);
        run('009_monthly.ra', dbPath, output);
        assert.deepEqual(fs.readFileSync(output, 'utf8').trim().split('\n'), expected);
        fs.writeFileSync(arrayScript, source.replace(
            'Db = DbPath sqlite\nB = Db .bookings', 'B = DbPath csv'));
        const array = spawnSync(process.execPath,
            [cli, arrayScript, csvPath, output], { cwd: root, encoding: 'utf8' });
        assert.equal(array.status, 0, array.stderr);
        assert.deepEqual(fs.readFileSync(output, 'utf8').trim().split('\n'), expected);
        fs.writeFileSync(inspect, source.replace('Result OutputPath csv',
            'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath, [cli, inspect, dbPath, output],
            { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /datetime\("starttime", 'start of month'\)/);
        assert.match(plan.stdout, /GROUP BY/);
    } finally {
        db.close();
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});
