import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { typedArray, readArrayItem } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const { mapStoredIntegers } = await import(pathToFileURL(`${root}/packages/interpreter/out/jit/integer-array-kernel.js`));
const mode = process.argv[2] ?? 'equal', size = 1048576;
const a = Int32Array.from({ length: mode === 'broadcast' ? 256 : size }, (_, i) => Math.imul(i + 1, 2654435761) >> 4);
const b = Int32Array.from({ length: mode === 'broadcast' ? 4096 : size }, (_, i) => Math.imul(i + 17, 2246822519) >> 4);
const left = typedArray(a, mode === 'broadcast' ? [256, 1] : [size]);
const right = typedArray(b, mode === 'broadcast' ? [1, 4096] : [size]);
const cpu = process.cpuUsage(), start = performance.now();
const result = mapStoredIntegers(left, right, mode === 'control' ? '+' : 'gcd');
const ms = performance.now() - start, used = process.cpuUsage(cpu), maxRssMiB = process.resourceUsage().maxRSS / 1024;
assert(result);
const gcd = (x, y) => { let a = x < 0n ? -x : x, b = y < 0n ? -y : y; while (b) { const r = a % b; a = b; b = r; } return a; };
for (let i = 0; i < size; i++) {
    const x = BigInt(a[mode === 'broadcast' ? Math.floor(i / 4096) : i]);
    const y = BigInt(b[mode === 'broadcast' ? i % 4096 : i]);
    assert.equal(readArrayItem(result, i), mode === 'control' ? x + y : gcd(x, y));
}
console.log(JSON.stringify({ mode, size, ms, cpuMs: (used.user + used.system) / 1000,
    maxRssMiB, node: process.version, arch: process.arch }));
