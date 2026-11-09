import { pathToFileURL } from 'node:url';
const entry = process.env.RANK558_RUNTIME ? pathToFileURL(process.env.RANK558_RUNTIME)
    : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { ownedArray, readArrayItem } = await import(new URL('./array-storage.js', entry));
const { sortedIndex, sortedIndexBatch } = await import(new URL('./sorted-search.js', entry));
const count = Number(process.argv[2] ?? 100000), collision = process.argv[3] === 'collision';
if (!Number.isSafeInteger(count) || count < 1) throw Error('expected a positive size');
const base = 10n ** 100n;
const values = Array.from({ length: 291 }, (_, i) => collision ? base + BigInt(i) : (1n << BigInt(i)) * base);
const queries = Array.from({ length: count }, (_, i) => values[(i * 97 + Math.floor(i / 291)) % values.length] + BigInt(i % 3 - 1));
const source = ownedArray(values), targets = ownedArray(queries), start = performance.now(), cpu = process.cpuUsage();
const result = sortedIndexBatch(source, targets, true) ?? ownedArray(queries.map(q => sortedIndex(source, q, true)));
const ms = performance.now() - start, used = process.cpuUsage(cpu);
for (let i = 0; i < count; i++) {
    let low = 0, high = values.length;
    while (low < high) { const middle = (low + high) >>> 1; if (values[middle] <= queries[i]) low = middle + 1; else high = middle; }
    if (readArrayItem(result, i) !== BigInt(low)) throw Error(`wrong query ${i}`);
}
console.log(JSON.stringify({ count, collision, ms, cpu: used, rssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch }));
