import { pathToFileURL } from 'node:url';
const runtime = process.env.RANK470_RUNTIME
    ? pathToFileURL(process.env.RANK470_RUNTIME)
    : new URL('../../packages/interpreter/out/index.js', import.meta.url);
const { numericSort } = await import(new URL('./runtime/numeric-collections.js', runtime));
const { typedArray, readArrayItem } = await import(new URL('./runtime/array-storage.js', runtime));
const samples = [];
const warmups = Number(process.argv[2] ?? 40);
const repeats = Number(process.argv[3] ?? 40);
for (const kind of ['small', 'constant', 'high-only', 'full-width']) {
    const cells = new Int32Array(262144);
    let random = 731;
    for (let i = 0; i < cells.length; i++) {
        random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
        cells[i] = kind === 'small' ? (random >>> 0) % 9261 : kind === 'constant' ? 7
            : kind === 'high-only' ? (random & 1023) << 22 : random;
    }
    const source = typedArray(cells);
    for (let i = 0; i < warmups; i++) numericSort(source, false, 'indexes');
    const start = performance.now();
    let result;
    for (let i = 0; i < repeats; i++) result = numericSort(source, false, 'indexes');
    const ms = performance.now() - start;
    let checksum = 0n;
    for (let i = 0; i < 100; i++) checksum += readArrayItem(result.indexes, i);
    samples.push({ kind, ms, checksum: String(checksum) });
}
console.log(JSON.stringify({ runtime: runtime.href, node: process.version, arch: process.arch, warmups, repeats, samples }));
