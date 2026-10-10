// Build first, then run: node benchmarks/memo-collatz.mjs [samples] [limit]
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Interpreter } from '../packages/interpreter/out/index.js';

const samples = Number(process.argv[2] ?? 3);
const limit = Number(process.argv[3] ?? 1000000);
assert(Number.isSafeInteger(samples) && samples > 0);
assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000000);

if (process.argv[4] === '--worker') {
    // Independent iterative oracle; exclude it from the measured work.
    const cache = new Map([[1, 1]]);
    let best = 1, longest = 1;
    for (let start = 2; start <= limit; start++) {
        let n = start;
        const path = [];
        while (!cache.has(n)) { path.push(n); n = n % 2 === 0 ? n / 2 : 3 * n + 1; }
        let length = cache.get(n);
        while (path.length) cache.set(path.pop(), ++length);
        if (cache.get(start) > longest) { longest = cache.get(start); best = start; }
    }
    cache.clear();
    global.gc();
    const runtime = new Interpreter(() => {});
    const before = performance.now();
    runtime.execute(`
use numbers
memo collatz N
  if N equal 1
    return 1
  elif N even
    N = N // 2
  else
    N = 3 * N + 1
  end
  return N collatz + 1
end
Seqs = 1 to ${limit} collatz rank 0
Answer = (Seqs max .index) + 1
`);
    const ms = performance.now() - before;
    assert.equal(runtime.variables.get('Answer'), BigInt(best));
    global.gc();
    console.log(JSON.stringify({ ms, answer: best, heapUsed: process.memoryUsage().heapUsed }));
    runtime.dispose();
} else {
    const records = [];
    for (let sample = 0; sample < samples; sample++) {
        const child = spawnSync(process.execPath,
            ['--expose-gc', fileURLToPath(import.meta.url), '1', String(limit), '--worker'],
            { encoding: 'utf8', timeout: 120000 });
        assert.equal(child.status, 0, child.error?.message ?? child.stderr);
        records.push(JSON.parse(child.stdout));
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, samples, limit,
        method: 'fresh process per sample; parsing and forced lazy reduction included; oracle and GC excluded; heapUsed is total live heap after GC, not peak',
        records, medianMs: median(records.map(record => record.ms)),
        medianHeapUsed: median(records.map(record => record.heapUsed)) }, null, 2));
}
