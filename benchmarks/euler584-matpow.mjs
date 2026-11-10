// Prepared-kernel control: imports, input setup and preparation are untimed.
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const entry = process.env.RANK584_RUNTIME ? pathToFileURL(process.env.RANK584_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { prepareMatrixPower } = await import(new URL('./modules/linalg.js', entry));
const { typedArray, readArrayItem } = await import(new URL('./array-storage.js', entry));
const size = 128, repeats = Number(process.argv[2] ?? 20), expected = 1 / size;
const source = typedArray(new Float64Array(size * size).fill(expected), [size, size]);
const kernel = prepareMatrixPower(source, 365n);
let digest;
function execute() {
    const result = kernel.run(), values = new Float64Array(size * size);
    for (let i = 0; i < values.length; i++) {
        const value = readArrayItem(result, i);
        if (value !== expected) throw Error(`Wrong cell at ${i}: ${String(value)}`);
        values[i] = value;
    }
    digest = createHash('sha256').update(new Uint8Array(values.buffer)).digest('hex');
}
execute(); execute();
const start = performance.now();
for (let i = 0; i < repeats; i++) execute();
console.log(JSON.stringify({ mode: 'matpow-kernel', size, repeats, ms: performance.now() - start,
    node: process.version, arch: process.arch, rssMiB: process.resourceUsage().maxRSS / 1024, digest }));
