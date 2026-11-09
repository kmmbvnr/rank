import {pathToFileURL} from 'node:url';
const root = process.env.RANK_SEARCH_ROOT;
const url = name => root ? pathToFileURL(root + '/' + name) : new URL('../packages/interpreter/out/' + name, import.meta.url);
const {sortedIndexBatch} = await import(url('sorted-search.js'));
const {typedArray, readArrayItem} = await import(url('array-storage.js'));
const source = typedArray(BigInt64Array.from({length:4096}, (_, i) => 9007199254740992n + BigInt(i * 3)));
const count = 3000000;
for (const ordered of [false, true]) {
    const queries = typedArray(BigInt64Array.from({length:count}, (_, i) =>
        9007199254740992n + BigInt(ordered ? Math.floor(i / 256) : (i * 7919) % 13000)));
    const start = performance.now();
    const found = sortedIndexBatch(source, queries, false);
    if (!found) throw Error('batch declined');
    for (const i of [0, 1, 10000, count - 1]) {
        const query = ordered ? Math.floor(i / 256) : (i * 7919) % 13000;
        if (readArrayItem(found, i) !== BigInt(Math.min(4096, Math.ceil(query / 3)))) throw Error('wrong index');
    }
    console.log(JSON.stringify({ordered,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,node:process.version,arch:process.arch}));
}
