// Run after langium:generate and the TypeScript build:
// node --expose-gc --max-old-space-size=512 benchmarks/parser-memory.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { EmptyFileSystem } from 'langium';
import { createRankServices } from '../packages/language/out/index.js';

assert.equal(typeof global.gc, 'function', 'run with --expose-gc');
const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const demos = new URL('../demos/', import.meta.url);
const reports = [];

function parse(source, name) {
    const result = parser.parse(source);
    assert.equal(result.lexerErrors.length, 0, `${name}: lexer errors`);
    assert.equal(result.parserErrors.length, 0, `${name}: parser errors`);
}

function measure(name, run) {
    const start = performance.now();
    const count = run();
    global.gc();
    reports.push({ name, count, milliseconds: Math.round(performance.now() - start),
        heapMiB: process.memoryUsage().heapUsed / 1024 ** 2 });
}

measure('sigmoid', () => {
    parse(fs.readFileSync(new URL('deepml/022_sigmoid.ra', demos), 'utf8'), 'sigmoid');
    return 1;
});
measure('nested calls', () => {
    for (const depth of [4, 8, 16, 32]) {
        parse(`X = ${'f ('.repeat(depth)}1${')'.repeat(depth)}`, `depth ${depth}`);
    }
    return 4;
});
const files = fs.readdirSync(demos, { recursive: true }).filter(file => file.endsWith('.ra')).sort();
for (let pass = 1; pass <= 2; pass++) {
    measure(`demos ${pass}`, () => {
        for (const file of files) parse(fs.readFileSync(new URL(file, demos), 'utf8'), file);
        return files.length;
    });
}
console.log(JSON.stringify(reports, null, 2));
