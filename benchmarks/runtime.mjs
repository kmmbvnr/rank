import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';

// Parse once; measure repeated execution of the same function bodies.
const runtime = new Interpreter();
runtime.execute(`
use ranges

fun tree N
  if N equal 0
    return 1
  end
  return ((N - 1) tree) + ((N - 1) tree)
end

fun total N
  Sum = 0
  for I in 0 until N
    Sum += I
  end
  return Sum
end
`);

for (const [name, argument, expected, warmup] of [
  ['tree', 14n, 16384n, 10n],
  ['total', 50000n, 1249975000n, 1000n],
]) {
  const fn = runtime.variables.get(name);
  for (let i = 0; i < 2; i++) fn.call([warmup]);
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    assert.equal(fn.call([argument]), expected);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(`${name}: median ${samples[2].toFixed(1)} ms (${samples.map(n => n.toFixed(1)).join(', ')})`);
}
runtime.dispose();
