import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const checkout = resolve(process.argv[2] ?? '.');
const test = process.argv[3] ?? '701';
const cases = { '701': ['701_randomconnectedarea.ra', 5.76487732, ['--ww=4', '--hh=4']],
    '077': ['077_primesummations.ra', 71, []],
    '491': ['491_doublepandigital.ra', 194505988824000, []] };
const [file, expected, args] = cases[test];
const {Interpreter, parse} = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
const source = parse(readFileSync(`demos/euler/${file}`, 'utf8'));
const outputs = [];
const runtime = new Interpreter(value => outputs.push(String(value)));
global.gc();
const start = performance.now();
runtime.executeProgram(source, args);
const milliseconds = performance.now() - start;
const answer = Number(outputs.join('').trim());
assert.equal(Number(answer.toFixed(8)), expected);
global.gc();
console.log(JSON.stringify({checkout, milliseconds, answer,
    peakRssKiB: process.resourceUsage().maxRSS,
    heapUsed: process.memoryUsage().heapUsed,
    scalarReads: globalThis.__scalarReads ?? null, node: process.version}));
runtime.dispose();
