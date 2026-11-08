import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { filledArray, fillBooleanSelection, booleanCells } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const size = 1048576, rounds = 8;
const input = filledArray(false, [size]);
const offsets = Int32Array.from({ length: size }, (_, i) => i * 277 & (size - 1));
const start = performance.now(), cpu = process.cpuUsage();
for (let round = 0; round < rounds; round++) fillBooleanSelection(input, size, i => offsets[i], round % 2 === 0);
const ms = performance.now() - start, used = process.cpuUsage(cpu);
assert(booleanCells(input).words.every(word => word === 0));
console.log(JSON.stringify({size, rounds, ms, cpuMs: (used.user + used.system) / 1000,
    maxRssMiB: process.resourceUsage().maxRSS / 1024, arch: process.arch, node: process.version}));
