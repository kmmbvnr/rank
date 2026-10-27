import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

it('preserves the runnable MLP program and weights through archive export/import', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rank-mlp-archive-'));
    try {
        await build({configFile:false,logLevel:'silent',build:{outDir:directory,minify:false,
            lib:{entry:fileURLToPath(new URL('../src/notebook-archive.ts',import.meta.url)),formats:['es'],fileName:()=> 'archive.mjs'}}});
        const {notebookArchive,readNotebookArchive} = await import(pathToFileURL(join(directory,'archive.mjs')).href);
        const main = await readFile(new URL('../../../demos/mlrank/mlp.ra',import.meta.url),'utf8');
        const source = await readFile(new URL('../../../demos/mlrank/classifier.ram',import.meta.url),'utf8');
        const snapshot = {cells:[],draft:main,modules:[{name:'classifier.ram',source,cursor:0}],activeModule:'classifier.ram'};
        assert.deepEqual(readNotebookArchive(notebookArchive(snapshot)),snapshot);
    } finally { await rm(directory,{recursive:true,force:true}); }
});
