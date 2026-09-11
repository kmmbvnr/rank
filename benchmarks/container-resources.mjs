import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const { Interpreter } = await import(process.argv[2] ?? '../packages/interpreter/out/index.js');
const runtime = new Interpreter();
runtime.execute(`
use algo
use ranges
use sequences
fun note Seen V
  Seen add V
  return Seen
end
fun setwork N
  Seen = new set
  for V in 0 until N
    Seen V note
  end
  return Seen len
end
fun heapwork N
  Heap = new heap
  for V in 0 until N
    Heap V V enqueue
  end
  return Heap len
end
`);
const results = [];
try {
  for (const name of ['setwork', 'heapwork']) {
    const fn = runtime.variables.get(name);
    for (let warmup = 0; warmup < 2; warmup++) assert.equal(fn.call([100n]), 100n);
    for (const size of [5000, 10000, 20000]) {
      const samples = [];
      for (let sample = 0; sample < 3; sample++) {
        const start = performance.now();
        assert.equal(fn.call([BigInt(size)]), BigInt(size));
        samples.push(performance.now() - start);
      }
      results.push({ name, size, samples, medianMs: [...samples].sort((a, b) => a - b)[1] });
    }
  }
} finally { runtime.dispose(); }
console.log(JSON.stringify({ date: new Date().toISOString(), node: process.version, results }, null, 2));
