import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const checkout = resolve(process.argv[2] ?? '.');
const {Interpreter, parse} = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
const text = JSON.parse(readFileSync('demos/euler/042_trianglewords_test.ra', 'utf8')
    .split('\n').find(line => line.startsWith('  Text = ')).slice(9));
const source = parse(readFileSync('demos/euler/042_trianglewords.ra', 'utf8'));
const outputs = [];
const runtime = new Interpreter(value => outputs.push(String(value)), {
    args: ['--input=words.txt'], io: {read: () => Buffer.from(text)},
});
let allocatedInt32Bytes = 0, allocations = 0;
const Native = globalThis.Int32Array;
if (process.argv.includes('--allocations')) globalThis.Int32Array = new Proxy(Native, {
    construct(target, args) {
        const array = Reflect.construct(target, args);
        if (typeof args[0] === 'number') { allocatedInt32Bytes += array.byteLength; allocations++; }
        return array;
    },
});
global.gc();
const start = performance.now();
runtime.executeProgram(source, ['--input=words.txt']);
const milliseconds = performance.now() - start;
assert.equal(outputs.join('').trim(), '162');
console.log(JSON.stringify({checkout, milliseconds, allocatedInt32Bytes, allocations,
    peakRssKiB: process.resourceUsage().maxRSS, node: process.version, answer: '162'}));
globalThis.Int32Array = Native;
runtime.dispose();
