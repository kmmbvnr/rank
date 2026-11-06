import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { typedArray, readArrayItem } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const { mapStoredIntegers } = await import(pathToFileURL(`${root}/packages/interpreter/out/integer-array-kernel.js`));
const scalar = process.argv[2] === 'scalar', width = 128, rounds = 5000;
const base = scalar ? 1n << 60n : -10000n;
const data = scalar ? BigInt64Array.from({ length: width }, (_, i) => base + BigInt(i))
    : Int32Array.from({ length: width }, (_, i) => Number(base) + i);
const left = typedArray(data), right = scalar ? 17n : typedArray(new Int32Array(width).fill(17));
let result;
const start = performance.now(), cpu = process.cpuUsage();
for (let i = 0; i < rounds; i++) result = mapStoredIntegers(left, right, 'mod');
const used = process.cpuUsage(cpu);
const ms = performance.now() - start, maxRssMiB = process.resourceUsage().maxRSS / 1024;
for (let i = 0; i < width; i++) assert.equal(readArrayItem(result, i), ((BigInt(data[i]) % 17n) + 17n) % 17n);
console.log(JSON.stringify({ scalar, rounds, ms, cpuMs: (used.user + used.system) / 1000,
    maxRssMiB, node: process.version, arch: process.arch }));
