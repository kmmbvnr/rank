// Fresh process per sample. Select a built checkout with RANK_ROOT.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..');
const load = path => import(pathToFileURL(resolve(root, 'packages/interpreter/out', path)));
const { Interpreter } = await load('index.js');
const { readArrayItem } = await load('array-storage.js');
const width = Number(process.argv[2] ?? 199);
const count = Number(process.argv[3] ?? width);
const compilation = process.argv[4] !== 'reference';
let source = readFileSync(process.env.RANK_SOURCE ?? resolve(root, 'demos/euler/707_lightsout.ra'), 'utf8');
source = source.replace('arg Width integer = 199', `Width = ${width}`)
    .replace('arg Count integer = 199', `Count = ${count}`);
const runtime = new Interpreter(() => {}, { compilation });
try {
    const cpu = process.cpuUsage(), start = performance.now();
    runtime.execute(source);
    const ms = performance.now() - start, used = process.cpuUsage(cpu);
    const answer = String(runtime.variables.get('Answer'));
    if (width === 199 && count === 199) assert.equal(answer, '652907799');
    const nullity = runtime.variables.get('Nullity');
    const nullities = Array.from({ length: count }, (_, i) => Number(readArrayItem(nullity, i)));
    console.log(JSON.stringify({ width, count, compilation, answer, nullities, ms, cpu: used,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch }));
} finally { runtime.dispose(); }
