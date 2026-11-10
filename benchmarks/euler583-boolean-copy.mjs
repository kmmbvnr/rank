// Hot-kernel control; imports, input construction and parsing are outside timing.
import { pathToFileURL } from 'node:url';
const entry = process.env.RANK583_RUNTIME ? pathToFileURL(process.env.RANK583_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { parse } = await import(entry);
const { compileTensorKernel } = await import(new URL('./tensor-kernel.js', entry));
const { typedArray, booleanCells } = await import(new URL('./array-storage.js', entry));
const count = Number(process.argv[2] ?? 1000000), repeats = Number(process.argv[3] ?? 10);
const left = Int32Array.from({ length: count }, (_, i) => i - Math.floor(count / 2));
const right = BigInt64Array.from(left, (value, i) => BigInt(value * value + (i % 3 === 0 ? 1 : 0)));
const values = new Map([['A', typedArray(left)], ['B', typedArray(right)]]);
const kernel = compileTensorKernel(parse('Result = (A * A equal B) copy').statements[0], {
    lookup: name => values.get(name), builtin: () => true,
});
if (!kernel) throw Error('copy kernel was rejected');
function execute() {
    const result = kernel.run(), bits = result && booleanCells(result);
    if (!bits) throw Error('missing bitmap');
    let total = 0;
    for (let word of bits.words) {
        word -= word >>> 1 & 0x55555555;
        word = (word & 0x33333333) + (word >>> 2 & 0x33333333);
        total += ((word + (word >>> 4) & 0x0f0f0f0f) * 0x01010101 >>> 24);
    }
    if (total !== count - Math.ceil(count / 3)) throw Error(`Wrong mask: ${total}`);
}
execute(); execute();
const start = performance.now();
for (let sample = 0; sample < repeats; sample++) execute();
console.log(JSON.stringify({ mode: 'boolean-copy-kernel', count, repeats, ms: performance.now() - start,
    node: process.version, arch: process.arch, rssMiB: process.resourceUsage().maxRSS / 1024 }));
