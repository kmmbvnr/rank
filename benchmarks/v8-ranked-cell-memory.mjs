import assert from 'node:assert/strict';
import {getHeapCodeStatistics} from 'node:v8';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const checkout = resolve(process.argv[2] ?? '.');
const test = process.argv[3] ?? '701';
const cases = { '701': ['701_randomconnectedarea.ra', 5.76487732, ['--ww=4', '--hh=4']],
    '077': ['077_primesummations.ra', 71, []],
    '491': ['491_doublepandigital.ra', 194505988824000, []],
    '048': ['048_selfpowers.ra', 9110846700, []],
    '026': ['026_reciprocal.ra', 983, []],
    '054': ['054_poker.ra', 376, []],
    '044': ['044_pentagondiff.ra', 5482660, []],
    '188': ['188_hyperexponentiation.ra', 95962097, []],
    '048-wide': ['048_selfpowers.ra', null, ['--digits=20']] };
const [file, expected, args] = cases[test];
const {Interpreter, parse} = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
const source = parse(readFileSync(`demos/euler/${file}`, 'utf8'));
const outputs = [];
const runtime = new Interpreter(value => outputs.push(String(value)), {
    io: {read: path => readFileSync(resolve(path))},
});
if (process.argv.includes('--warm')) {
    for (let i = 0; i < 4; i++) { runtime.executeProgram(source, args); outputs.length = 0; }
}
let coordinateArrays = 0;
const NativeArray = globalThis.Array;
if (process.argv.includes('--coordinate-allocations')) globalThis.Array = new Proxy(NativeArray, {
    apply(target, receiver, args) {
        const frames = new Error().stack.split('\n').slice(2, 4);
        if (/at Object.cellAt .*rank-application.js/.test(frames[0])
            || /at coordinatesAt .*tensor-index.js/.test(frames[0])
                && /at Object.cellAt .*rank-application.js/.test(frames[1])) coordinateArrays++;
        return Reflect.apply(target, receiver, args);
    },
});
global.gc();
const start = performance.now();
runtime.executeProgram(source, args);
const milliseconds = performance.now() - start;
const answer = Number(outputs.join('').trim());
if (test === '048-wide') {
    let total = 0n;
    const modulus = 10n ** 20n;
    for (let n = 1n; n <= 1000n; n++) total = (total + n ** n) % modulus;
    assert.equal(outputs.join('').trim(), String(total));
} else assert.equal(Number(answer.toFixed(8)), expected);
global.gc();
const heapSameJob = process.memoryUsage().heapUsed;
let heapAfterJob;
if (process.argv.includes('--settle')) {
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    await new Promise(resolve => setImmediate(resolve));
    global.gc();
    heapAfterJob = process.memoryUsage().heapUsed;
}
console.log(JSON.stringify({heapSameJob, heapAfterJob, checkout, milliseconds, answer,
    peakRssKiB: process.resourceUsage().maxRSS,
    coordinateArrays, heapUsed: process.memoryUsage().heapUsed, code: getHeapCodeStatistics(),
    runCompiles: globalThis.__runCompiles ?? null, scalarReads: globalThis.__scalarReads ?? null, positionalCalls: globalThis.__positionalCalls ?? null, node: process.version}));
globalThis.Array = NativeArray;
runtime.dispose();
