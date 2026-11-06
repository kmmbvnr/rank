import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { typedArray, integer32Cells } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const { mapStoredIntegers } = await import(pathToFileURL(`${root}/packages/interpreter/out/integer-array-kernel.js`));
const width = Number(process.argv[2] ?? 1048576), rows = 16, compact = process.env.MODE === 'compact';
const base = compact ? -1073741824n : 1n << 60n;
const left = typedArray(compact ? Int32Array.from({ length: width }, (_, i) => Number(base) + i * 17)
    : BigInt64Array.from({ length: width }, (_, i) => base + BigInt(i) * 17n), [1, width]);
const right = typedArray(Int32Array.from({ length: rows }, (_, i) => 1009 + i * 30), [rows, 1]);
const start = performance.now(), cpu = process.cpuUsage();
const result = mapStoredIntegers(left, right, 'mod');
const used = process.cpuUsage(cpu);
const observation = { ms: performance.now() - start, cpuMs: (used.user + used.system) / 1000,
    maxRssMiB: process.resourceUsage().maxRSS / 1024, width, rows, compact, node: process.version, arch: process.arch };
const cells = integer32Cells(result);
assert.ok(cells);
for (let row = 0; row < rows; row++) {
    const divisor = 1009 + row * 30, first = Number((base % BigInt(divisor) + BigInt(divisor)) % BigInt(divisor));
    for (let i = 0; i < width; i++) assert.equal(cells[row * width + i], (first + i * 17) % divisor);
}
console.log(JSON.stringify(observation));
