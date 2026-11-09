import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK557_RUNTIME;
const entry = chosen ? pathToFileURL(chosen) : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { typedArray } = await import(new URL('./array-storage.js', entry));
const { mapStoredIntegers } = await import(new URL('./integer-array-kernel.js', entry));
const [operation = '*', text = '200000'] = process.argv.slice(2), size = Number(text), factor = 16384n;
if (!['*', '//'].includes(operation) || !Number.isSafeInteger(size) || size < 1) throw Error('expected * or // and a positive size');
const cells = BigInt64Array.from({ length: size }, (_, i) => {
    const value = (operation === '*' ? 1n << 40n : 1n << 54n) + BigInt(i);
    return i % 2 ? -value : value;
});
const input = typedArray(cells), start = performance.now(), cpu = process.cpuUsage();
const result = mapStoredIntegers(input, factor, operation), ms = performance.now() - start, used = process.cpuUsage(cpu);
if (!result) throw Error('expected an array');
for (let i = 0; i < size; i++) {
    const value = cells[i], q = value / factor, expected = operation === '*' ? value * factor : value % factor < 0n ? q - 1n : q;
    if (result.items[i] !== expected) throw Error(`wrong cell ${i}`);
}
console.log(JSON.stringify({ operation, size, ms, cpu: used, rssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch }));
