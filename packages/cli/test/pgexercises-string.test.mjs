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
const examples = path.join(root, 'demos/pgexercises/string');

function run(file, database, output, source = path.join(examples, file)) {
    const result = spawnSync(process.execPath,
        [cli, source, database, output],
        { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return fs.readFileSync(output, 'utf8').trimEnd();
}

function csv(rows, columns) {
    const cell = value => {
        const text = value === null ? '' : String(value);
        return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    return [columns.join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))]
        .join('\n');
}

test('member names concatenate lazily on SQLite and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-string-'));
    const database = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(database);
    try {
        db.exec('CREATE TABLE members (memid INTEGER, firstname TEXT, surname TEXT); '
            + "INSERT INTO members VALUES (2, 'Jo,an', 'Baker'), "
            + "(0, 'GUEST', 'GUEST'), (1, 'Jane', 'Smith')");
        const oracle = db.prepare("SELECT surname || ', ' || firstname AS name FROM members").all();
        assert.equal(run('001_names.ra', database, output), csv(oracle, ['name']));
        const inspectFile = path.join(dir, 'inspect.ra');
        fs.writeFileSync(inspectFile,
            fs.readFileSync(path.join(examples, '001_names.ra'), 'utf8')
                .replace('Result OutputPath csv', 'use io\nQ = Result sql\nQ .text print'));
        const plan = spawnSync(process.execPath, [cli, inspectFile, database],
            { cwd: root, encoding: 'utf8' });
        assert.equal(plan.status, 0, plan.stderr);
        assert.match(plan.stdout, /"surname" \|\| \?/);
        assert.match(plan.stdout, /\|\| "firstname"/);
        assert.doesNotMatch(plan.stdout, /GUEST/);
        const source = fs.readFileSync(path.join(examples, '001_names.ra'), 'utf8')
            .replace('Db = DbPath sqlite',
                `use json\nDb = ${JSON.stringify(JSON.stringify({ members: db.prepare('SELECT * FROM members').all() }))} json`);
        const arrayFile = path.join(dir, 'array.ra');
        fs.writeFileSync(arrayFile, source);
        assert.equal(run('001_names.ra', database, output, arrayFile), csv(oracle, ['name']));
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('all string exercises agree with SQLite oracles on SQLite and arrays', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-string-'));
    const database = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const db = new Database(database);
    try {
        db.exec('CREATE TABLE facilities (facid INTEGER, name TEXT, membercost REAL, '
            + 'guestcost REAL, initialoutlay REAL, monthlymaintenance REAL); '
            + 'CREATE TABLE members (memid INTEGER, firstname TEXT, surname TEXT, '
            + 'telephone TEXT, zipcode INTEGER)');
        const addFacility = db.prepare('INSERT INTO facilities VALUES (?, ?, ?, ?, ?, ?)');
        for (const row of [
            [0, 'Tennis Court 1', 5, 25, 10000, 200],
            [1, 'tennis Court 2', 5, 25, 8000, 200],
            [2, 'Badminton', 1, 10, 500, 50],
            [3, 'Tennis', 5, 25, 9000, 200],
        ]) addFacility.run(...row);
        const addMember = db.prepare('INSERT INTO members VALUES (?, ?, ?, ?, ?)');
        for (const row of [
            [2, 'Jo,an', 'Baker', '(844) 123-4567', 234],
            [0, 'GUEST', 'GUEST', '000 000-0000', 0],
            [1, 'Jane', 'Smith', '844)1234567', 12345],
            [3, 'Jack', 'Smith', '8441234567', 123456],
            [4, 'Ada', 'Åberg', '(123) 456-7890', 4321],
        ]) addMember.run(...row);
        const cases = [
            ['001_names.ra', "SELECT surname || ', ' || firstname AS name FROM members", ['name']],
            ['002_prefix.ra', 'SELECT * FROM facilities WHERE substr(name, 1, 6) = ?',
                ['facid', 'name', 'membercost', 'guestcost', 'initialoutlay', 'monthlymaintenance'], ['Tennis']],
            ['003_case.ra', 'SELECT * FROM facilities WHERE lower(substr(name, 1, 6)) = ?',
                ['facid', 'name', 'membercost', 'guestcost', 'initialoutlay', 'monthlymaintenance'], ['tennis']],
            ['004_phone.ra', 'SELECT memid, telephone FROM members '
                + "WHERE instr(telephone, '(') > 0 OR instr(telephone, ')') > 0 ORDER BY memid",
                ['memid', 'telephone']],
            ['005_zip.ra', 'SELECT CASE WHEN length(CAST(zipcode AS TEXT)) < 5 '
                + "THEN substr('00000', 1, 5-length(CAST(zipcode AS TEXT))) || CAST(zipcode AS TEXT) "
                + 'ELSE CAST(zipcode AS TEXT) END AS zip FROM members ORDER BY zip', ['zip']],
            ['006_initial.ra', 'SELECT substr(surname, 1, 1) AS letter, COUNT(*) AS count '
                + 'FROM members GROUP BY letter ORDER BY letter', ['letter', 'count']],
            ['007_clean.ra', 'SELECT memid, '
                + "replace(replace(replace(replace(telephone, '-', ''), '(', ''), ')', ''), ' ', '') "
                + 'AS telephone FROM members ORDER BY memid', ['memid', 'telephone']],
        ];
        const plans = [
            /"surname" \|\| \?/, /rank_startswith/, /rank_lower.*rank_startswith|rank_startswith.*rank_lower/,
            /instr\(/, /rank_lpad\(rank_text\(/, /rank_text_slice\(/, /rank_translate\(/,
        ];
        const arrays = {
            facilities: db.prepare('SELECT * FROM facilities').all(),
            members: db.prepare('SELECT * FROM members').all(),
        };
        for (const [index, [file, sql, columns, params = []]] of cases.entries()) {
            await t.test(file, () => {
                const expected = csv(db.prepare(sql).all(...params), columns);
                assert.equal(run(file, database, output), expected);
                const source = fs.readFileSync(path.join(examples, file), 'utf8')
                    .replace('Db = DbPath sqlite',
                        `use json\nDb = ${JSON.stringify(JSON.stringify(arrays))} json`);
                const arrayFile = path.join(dir, 'array.ra');
                fs.writeFileSync(arrayFile, source);
                assert.equal(run(file, database, output, arrayFile), expected);
                const inspectFile = path.join(dir, 'inspect.ra');
                fs.writeFileSync(inspectFile,
                    fs.readFileSync(path.join(examples, file), 'utf8')
                        .replace('Result OutputPath csv', 'use io\nQ = Result sql\nQ .text print'));
                const plan = spawnSync(process.execPath,
                    [cli, inspectFile, database], { cwd: root, encoding: 'utf8' });
                assert.equal(plan.status, 0, plan.stderr);
                assert.match(plan.stdout, plans[index]);
            });
        }
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Unicode text functions and slices agree on SQLite and arrays', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-pg-string-'));
    const database = path.join(dir, 'club.sqlite3');
    const output = path.join(dir, 'out.csv');
    const sourceFile = path.join(dir, 'unicode.ra');
    const db = new Database(database);
    try {
        db.exec('CREATE TABLE strings (value TEXT)');
        const values = ['Ä😀(x)', 'A', 'é'];
        const insert = db.prepare('INSERT INTO strings VALUES (?)');
        for (const value of values) insert.run(value);
        const program = [
            'use cli', 'use tables', 'use text',
            'argument DbPath path', 'argument OutputPath path',
            'Db = DbPath sqlite', 'R = Db .strings',
            'Texts = R .value', 'Lower = Texts lower',
            'Padded = Texts 7 "é🙂" lpad',
            'Clean = Texts "Ä(" "a" translate',
            'First = Texts initial rank 0',
            'IsA = Texts equal "A"',
            'Label = IsA text rank 0',
            'Result = R select',
            '  .lower = Lower', '  .padded = Padded',
            '  .clean = Clean', '  .first = First',
            '  .label = Label', 'end',
            'Result OutputPath csv',
            'fun initial Text', '  return Text from 0 until 1', 'end',
        ].join('\n');
        fs.writeFileSync(sourceFile, program);
        const expected = csv(values.map(value => {
            const width = 7 - [...value].length;
            return {
                lower: value.toLowerCase(),
                padded: Array.from({ length: Math.max(width, 0) },
                    (_, index) => ['é', '🙂'][index % 2]).join('') + value,
                clean: [...value].map(char => char === 'Ä' ? 'a' : char === '(' ? '' : char).join(''),
                first: [...value][0],
                label: String(value === 'A'),
            };
        }), ['lower', 'padded', 'clean', 'first', 'label']);
        assert.equal(run('unicode.ra', database, output, sourceFile), expected);
        fs.writeFileSync(sourceFile, program.replace('Db = DbPath sqlite',
            `use json\nDb = ${JSON.stringify(JSON.stringify({ strings: values.map(value => ({ value })) }))} json`));
        assert.equal(run('unicode.ra', database, output, sourceFile), expected);
        insert.run(null);
        fs.writeFileSync(sourceFile, program);
        assert.equal(run('unicode.ra', database, output, sourceFile), expected + '\n,,,,false');
    } finally {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
