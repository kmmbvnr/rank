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
