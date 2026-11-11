// Instrumentation run only. Array publication does not copy the packed buffer.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = resolve(process.argv[2]);
const {Interpreter} = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/index.js')));
const {IntegerCells} = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/runtime/owned-array.js')));
const {ownedStorage} = await import(pathToFileURL(resolve(root, 'packages/interpreter/out/runtime/array-storage-state.js')));
const original = IntegerCells.prototype.array;
const stats = {prefixPublications: 0, maxPrefixBufferBytes: 0, totalPublishedPrefixBytes: 0,
    copiedPrefixBuffers: 0, maxRssAtPrefix: 0, maxReferenceSlots: 0};
IntegerCells.prototype.array = function(shape) {
    const buffer = this.packed;
    const result = original.call(this, shape);
    const stack = new Error().stack;
    if (stack.includes('/runtime/binding-cells.js:') && stack.includes('at Object.write (')) {
        stats.prefixPublications++;
        stats.maxPrefixBufferBytes = Math.max(stats.maxPrefixBufferBytes, buffer?.byteLength || 0);
        stats.totalPublishedPrefixBytes += buffer?.byteLength || 0;
        stats.copiedPrefixBuffers += Number(ownedStorage.get(result)?.typed !== buffer);
        stats.maxRssAtPrefix = Math.max(stats.maxRssAtPrefix, process.memoryUsage().rss);
        stats.maxReferenceSlots = Math.max(stats.maxReferenceSlots, shape.reduce((n, d) => n * d, 1));
    }
    return result;
};
const output = [], runtime = new Interpreter(text => output.push(text), {args: []});
try {
    runtime.execute(readFileSync(resolve(root, 'demos/euler/792_toomanytwos.ra'), 'utf8'));
    if (output.join('\n') !== '2500500025183626') throw Error('Wrong answer');
    console.log(JSON.stringify({...stats, output, peakRssMiB: process.resourceUsage().maxRSS / 1024,
        node: process.version, arch: process.arch}));
} finally { IntegerCells.prototype.array = original; runtime.dispose(); }
