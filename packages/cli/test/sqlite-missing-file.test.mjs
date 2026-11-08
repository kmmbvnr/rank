import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nodeIo} from '../out/node-io.js';

test('missing SQLite files retain ENOENT and the requested path', t => {
    const dir = mkdtempSync(join(tmpdir(), 'rank-sqlite-missing-'));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    const path = join(dir, 'missing.sqlite3');
    assert.throws(() => nodeIo.openSqlite(path), error => error.code === 'ENOENT' && error.path === path);
});

test('existing invalid SQLite files are not reported as missing', t => {
    const dir = mkdtempSync(join(tmpdir(), 'rank-sqlite-invalid-'));
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    const path = join(dir, 'invalid.sqlite3');
    writeFileSync(path, 'invalid database'.repeat(100));
    assert.throws(() => {
        const db = nodeIo.openSqlite(path);
        try { db.prepare('SELECT * FROM sqlite_master'); }
        finally { db.close(); }
    }, error => error.code === 'SQLITE_NOTADB');
});
