import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.argv[2] ?? '.');
const {Interpreter, parse} = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
const runtime = new Interpreter();
runtime.execute('use numbers\nInput = (1 to 1000000) array');
const program = parse('Roots = Input isqrt array\nRoots sum');
for (let n = 0; n < 8; n++) runtime.executeProgram(program);
let bytes = 0, allocations = 0;
const Original = globalThis.Int32Array;
if (process.argv.includes('--allocations')) globalThis.Int32Array = new Proxy(Original, {
    construct(target, args) {
        const out = Reflect.construct(target, args);
        if (typeof args[0] === 'number') { bytes += out.byteLength; allocations++; }
        return out;
    },
});
global.gc();
const before = process.memoryUsage();
const times = [];
let answer;
for (let n = 0; n < 12; n++) {
    const start = performance.now();
    answer = runtime.executeProgram(program);
    times.push(performance.now() - start);
}
let expected = 0n;
for (let n = 1; n <= 1000000; n++) expected += BigInt(Math.floor(Math.sqrt(n)));
assert.equal(answer, expected);
global.gc();
console.log(JSON.stringify({times, answer: String(answer), bytes, allocations,
    heapDelta: process.memoryUsage().heapUsed - before.heapUsed,
    buffersDelta: process.memoryUsage().arrayBuffers - before.arrayBuffers,
    peakRssKiB: process.resourceUsage().maxRSS, node: process.version}));
globalThis.Int32Array = Original;
runtime.dispose();
