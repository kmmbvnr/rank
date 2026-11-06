import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const load = name => import(pathToFileURL(`${root}/packages/interpreter/out/${name}`));
const { mapStoredIntegers } = await load('jit/integer-array-kernel.js');
const { typedArray, ownedArray, readArrayItem } = await load('array-storage.js');
const op = process.argv[2] ?? '+', width = Number(process.argv[3] ?? 131072);
assert.ok(['+', '-', '*', 'min', 'max'].includes(op));
const values = Int32Array.from({ length: width }, (_, i) => i % 1999 - 999);
const constants = Array.from({ length: 16 }, (_, i) => BigInt(i % 7 - 3));
const left = typedArray(values, [1, 1, width]);
const right = process.env.TYPED ? typedArray(Int32Array.from(constants, Number), [4, 4, 1])
    : ownedArray(constants, [4, 4, 1], true);
const start = performance.now(), cpu = process.cpuUsage();
const result = mapStoredIntegers(left, right, op);
const used = process.cpuUsage(cpu);
const report = { op, width, rows: 16, boxed: !process.env.TYPED, ms: performance.now() - start,
    cpuMs: (used.user + used.system) / 1000, maxRssMiB: process.resourceUsage().maxRSS / 1024,
    node: process.version, arch: process.arch };
assert.ok(result);
for (let row = 0; row < 16; row++) {
    const b = constants[row];
    for (let i = 0; i < width; i++) {
        const a = BigInt(values[i]);
        const expected = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b
            : op === 'min' ? a < b ? a : b : a > b ? a : b;
        assert.equal(readArrayItem(result, row * width + i), expected);
    }
}
console.log(JSON.stringify(report));
