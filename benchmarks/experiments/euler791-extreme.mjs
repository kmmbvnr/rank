import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { Interpreter } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const { typedArray } = await import(pathToFileURL(`${root}/packages/interpreter/out/array-storage.js`));
const cells = Int32Array.from({ length: 262144 }, (_, i) => (i * 37) % 20001 - 10000);
const expected = BigInt(cells.reduce((sum, n) => sum + Math.min(5000, Math.max(-1000, n)), 0)) * 16n;
const runtime = new Interpreter(() => {});
runtime.variables.set('Values', typedArray(cells));
const start = performance.now(), cpu = process.cpuUsage();
try {
    runtime.execute(`fun Input clampSum
 Low' = Input max -1000
 High' = Low min 5000
 return High sum
end
Answer = 0
for I in 1 to 16
 Part = Values clampSum
 Answer = Answer + Part
end`);
    assert.equal((runtime.variables.get('Answer') ?? runtime.lastResult), expected);
    const used = process.cpuUsage(cpu);
    console.log(JSON.stringify({ ms: performance.now() - start, cpuMs: (used.user + used.system) / 1000,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, answer: String(expected), node: process.version, arch: process.arch }));
} finally { runtime.dispose(); }
