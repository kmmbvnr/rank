import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '..'));
const { Interpreter } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const size = Number(process.argv[2] ?? 1048576), repeats = 24;
const accumulate = process.env.ACCUMULATE !== '0';
let sum = 0;
const last = new Int32Array(4096);
for (let i = 0; i < size; i++) {
    const value = ((i % 97) * 13 + 7) % 101;
    sum += value; last[i % 4096] = value;
}
if (!accumulate) sum = last.reduce((sum, value) => sum + value, 0);
const runtime = new Interpreter(() => {});
try {
    runtime.execute(`Count = ${size}
Keys = (0 till Count) mod 4096
Weights = (0 till Count) mod 97
Values = array shape 4096 fill 1`);
    const start = performance.now(), cpu = process.cpuUsage();
    runtime.execute(`for I in 1 to ${repeats}
 Values Keys += (Weights * 13 + 7) mod 101 ${accumulate ? ".accumulate" : ""}
 Done = I
end`);
    const ms = performance.now() - start, used = process.cpuUsage(cpu);
    const answer = runtime.execute('Values sum');
    assert.equal(answer, BigInt(4096 + repeats * sum));
    console.log(JSON.stringify({ size, repeats, accumulate, answer: String(answer), ms, cpuMs: (used.user + used.system) / 1000,
        maxRssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, arch: process.arch }));
} finally { runtime.dispose(); }
