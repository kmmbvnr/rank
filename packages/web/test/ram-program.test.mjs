import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { Notebook } from '@arrrank/common/notebook';
let attachRamCall, directory;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rank-ram-program-'));
    await build({ configFile: false, logLevel: 'silent', build: {
        outDir: directory, minify: false,
        lib: { entry: fileURLToPath(new URL('../src/ram-program.ts', import.meta.url)),
            formats: ['es'], fileName: () => 'ram-program.mjs' },
    } });
    ({ attachRamCall } = await import(pathToFileURL(join(directory, 'ram-program.mjs')).href));
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe('RAM module creation edits Program', () => {
    it('inserts an import first and a call last without executing or discarding a draft', () => {
        const book = new Notebook();
        book.enqueue('X = array shape 1 64 fill 1.0');
        book.cells[0].output = [{ text: 'saved result' }];
        book.replace('rem unfinished draft');
        const cursor = book.cursor;
        attachRamCall(book, 'hello.ram');
        assert.deepEqual(book.cells.map(cell => cell.source), [
            'use "hello.ram"', 'X = array shape 1 64 fill 1.0', 'rem unfinished draft\nX hello',
        ]);
        assert.deepEqual(book.cells[1].output, [{ text: 'saved result' }]);
        assert.equal(book.cursor, cursor);
        assert.equal(book.dirtyFrom, 0);
    });
    it('reuses an existing aliased import and does not duplicate the appended call', () => {
        const book = new Notebook();
        book.enqueue('use "hello.ram" as M');
        book.replace('rem draft');
        attachRamCall(book, 'hello.ram');
        attachRamCall(book, 'hello.ram');
        assert.deepEqual(book.cells.map(cell => cell.source), ['use "hello.ram" as M', 'rem draft\nX M.hello']);
    });
    it('finds an import before an incomplete expression in the draft', () => {
        const book = new Notebook();
        book.replace('use "hello.ram"\nY = (');
        attachRamCall(book, 'hello.ram');
        assert.equal(book.cells.length, 1);
        assert.equal(book.current.source, 'use "hello.ram"\nY = (\nX hello');
    });
    it('keeps an incomplete expression and a cursor in an earlier cell', () => {
        const book = new Notebook();
        book.enqueue('X = 1.0');
        book.replace('Y = (');
        book.selectTo(0, 2);
        attachRamCall(book, 'newmodule.ram');
        assert.equal(book.current.source, 'X = 1.0');
        assert.equal(book.cursor, 2);
        assert.equal(book.cells.at(-1)?.source, 'Y = (\nX newmodule');
    });
});
