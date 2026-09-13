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
const examples = path.join(root, 'demos/pgexercises/recursive');

function run(source, database, output) {
    const result = spawnSync(process.execPath, [cli, source, database, output],
        { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
}

function csv(rows, columns) {
    return [columns.join(','), ...rows.map(row =>
        columns.map(key => row[key] === null ? '' : String(row[key])).join(','))].join('\n');
}

function members(db) {
    db.exec('CREATE TABLE members (memid INTEGER, firstname TEXT, surname TEXT, recommendedby INTEGER)');
    const add = db.prepare('INSERT INTO members VALUES (?, ?, ?, ?)');
    for (const [id, parent] of [
        [0, null], [1, null], [4, 1], [5, 1], [7, 4], [10, 5], [11, 5],
        [14, 7], [20, 5], [21, 20], [26, 14], [27, 20],
        [6, null], [9, 6], [12, 9], [13, null], [16, 13], [22, 16],
        [30, 31], [31, 30], [33, 99],
    ]) add.run(id, `First${id}`, `Last${id}`, parent);
}

const oracles = [
    `WITH RECURSIVE up(recommender) AS (
        SELECT recommendedby FROM members WHERE memid=27
        UNION
        SELECT m.recommendedby FROM up u JOIN members m ON m.memid=u.recommender
    )
    SELECT u.recommender, m.firstname, m.surname FROM up u
    JOIN members m ON m.memid=u.recommender ORDER BY u.recommender DESC`,
    `WITH RECURSIVE down(memid) AS (
        SELECT memid FROM members WHERE recommendedby=1
        UNION
        SELECT m.memid FROM down d JOIN members m ON m.recommendedby=d.memid
    )
    SELECT d.memid, m.firstname, m.surname FROM down d
    JOIN members m ON m.memid=d.memid ORDER BY d.memid`,
    `WITH RECURSIVE up(member,recommender) AS (
        SELECT memid,recommendedby FROM members WHERE recommendedby IS NOT NULL
        UNION
        SELECT u.member,m.recommendedby FROM up u
        JOIN members m ON m.memid=u.recommender WHERE m.recommendedby IS NOT NULL
    )
    SELECT u.member,u.recommender,m.firstname,m.surname FROM up u
    JOIN members m ON m.memid=u.recommender WHERE u.member IN (12,22)
    ORDER BY u.member,u.recommender DESC`,
];

test('all three Recursive programs match independent SQL on SQLite and arrays', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pgrec-'));
    const database = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(database);
    try {
        members(db);
        const files = fs.readdirSync(examples).filter(name => /^\d{3}_.*\.ra$/.test(name)).sort();
        assert.equal(files.length, 3);
        const withoutNull = row => Object.fromEntries(Object.entries(row)
            .filter(([, value]) => value !== null));
        const data = { members: db.prepare('SELECT * FROM members').all().map(withoutNull) };
        for (const [index, file] of files.entries()) {
            await t.test(file, () => {
                assert.equal(Number(file.slice(0, 3)), index + 1);
                const reference = db.prepare(oracles[index]);
                const columns = reference.columns().map(column => column.name);
                const expected = csv(reference.all(), columns);
                const source = path.join(examples, file);
                run(source, database, output);
                assert.equal(fs.readFileSync(output, 'utf8').trimEnd(), expected);

                const arraySource = path.join(dir, 'array.ra');
                fs.writeFileSync(arraySource, fs.readFileSync(source, 'utf8')
                    .replace('Db = DbPath sqlite',
                        `use json\nDb = ${JSON.stringify(JSON.stringify(data))} json`));
                run(arraySource, database, output);
                assert.equal(fs.readFileSync(output, 'utf8').trimEnd(), expected);

                const inspect = path.join(dir, 'inspect.ra');
                fs.writeFileSync(inspect, fs.readFileSync(source, 'utf8')
                    .replace('Result OutputPath csv', 'use io\nQ = Result sql\nQ .text print'));
                const sql = run(inspect, database, output);
                assert.match(sql, /WITH RECURSIVE/);
                assert.match(sql, /UNION/);
                if (index < 2) {
                    assert.match(sql, /SELECT \? AS start/);
                    assert.doesNotMatch(sql, /(?:=|\s)27(?:\s|\b)/);
                }
            });
        }
        const explain = path.join(dir, 'explain.ra');
        fs.writeFileSync(explain, fs.readFileSync(path.join(examples, files[0]), 'utf8')
            .replace('Result OutputPath csv', 'Result explain OutputPath csv'));
        run(explain, database, output);
        assert.match(fs.readFileSync(output, 'utf8'), /detail/);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('reach skips missing edges, duplicate seeds and cycle returns', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-reach-'));
    const database = path.join(dir, 'edges.sqlite3');
    const output = path.join(dir, 'out.csv');
    const source = path.join(dir, 'reach.ra');
    const db = new Database(database);
    try {
        db.exec('CREATE TABLE edges (src INTEGER, dst INTEGER)');
        const add = db.prepare('INSERT INTO edges VALUES (?, ?)');
        for (const row of [[1, 2], [1, 2], [2, 3], [3, 1], [2, 4], [5, null]]) add.run(...row);
        const program = [
            'use cli', 'use sequences', 'use tables',
            'argument DbPath path', 'argument OutputPath path',
            'Db = DbPath sqlite', 'E = Db .edges',
            'Starts = array 1 1 4',
            'Result = E Starts reach by .src .dst',
            'Result = Result sort by .src .dst',
            'Result OutputPath csv',
        ].join('\n');
        fs.writeFileSync(source, program);
        const reference = db.prepare(`WITH RECURSIVE paths(src,dst) AS (
            SELECT 1,dst FROM edges WHERE src=1 AND dst IS NOT NULL
            UNION
            SELECT p.src,e.dst FROM paths p JOIN edges e ON e.src=p.dst
            WHERE e.dst IS NOT NULL
        ) SELECT src,dst FROM paths WHERE src<>dst ORDER BY src,dst`).all();
        const expected = csv(reference, ['src', 'dst']);
        run(source, database, output);
        assert.equal(fs.readFileSync(output, 'utf8').trimEnd(), expected);
        fs.writeFileSync(source, program.replace('Db = DbPath sqlite',
            `use json\nDb = ${JSON.stringify(JSON.stringify({ edges: db.prepare('SELECT * FROM edges').all().map(
                row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)),
            ) }))} json`));
        run(source, database, output);
        assert.equal(fs.readFileSync(output, 'utf8').trimEnd(), expected);
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('computed SQLite start columns retain their bound expression parameters', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-reach-seeds-'));
    const database = path.join(dir, 'edges.sqlite3');
    const output = path.join(dir, 'out.csv');
    const source = path.join(dir, 'reach.ra');
    const db = new Database(database);
    try {
        db.exec('CREATE TABLE edges (src INTEGER, dst INTEGER); '
            + 'INSERT INTO edges VALUES (1,2),(2,3),(8,9); '
            + 'CREATE TABLE seeds (id INTEGER); INSERT INTO seeds VALUES (0),(7)');
        const program = [
            'use cli', 'use sequences', 'use tables',
            'argument DbPath path', 'argument OutputPath path',
            'Db = DbPath sqlite', 'E = Db .edges', 'S = Db .seeds',
            'Starts = S .id + 1',
            'Result = E Starts reach by .src .dst',
            'Result = Result sort by .src .dst',
            'Result OutputPath csv',
        ].join('\n');
        fs.writeFileSync(source, program);
        run(source, database, output);
        assert.equal(fs.readFileSync(output, 'utf8').trimEnd(), 'src,dst\n1,2\n1,3\n8,9');
        const data = {
            edges: db.prepare('SELECT * FROM edges').all(),
            seeds: db.prepare('SELECT * FROM seeds').all(),
        };
        fs.writeFileSync(source, program.replace('Db = DbPath sqlite',
            `use json\nDb = ${JSON.stringify(JSON.stringify(data))} json`));
        run(source, database, output);
        assert.equal(fs.readFileSync(output, 'utf8').trimEnd(), 'src,dst\n1,2\n1,3\n8,9');
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
