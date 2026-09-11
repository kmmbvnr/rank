import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';

const runtime = new Interpreter();
runtime.execute(`
use algo
fun manual N
  Cache = index
  return N Cache fib

  fun fib N Cache
    if N in Cache
      return Cache N
    end
    if N less 2
      Value = N
    else
      Value = ((N - 1) Cache fib) + ((N - 2) Cache fib)
    end
    Cache N = Value
    return Value
  end
end

fun fresh N
  return N fib

  memo fib N
    if N less 2
      return N
    end
    return ((N - 1) fib) + ((N - 2) fib)
  end
end

memo cached N
  if N less 2
    return N
  end
  return ((N - 1) cached) + ((N - 2) cached)
end
`);

// Every manual/fresh call creates a new cache. Only cached measures cache hits.
const iterations = 1000;
for (const name of ['manual', 'fresh', 'cached']) {
  const fn = runtime.variables.get(name);
  for (let i = 0; i < 20; i++) assert.equal(fn.call([30n]), 832040n);
  const samples = [];
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) assert.equal(fn.call([30n]), 832040n);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(`${name}: ${iterations} calls, median ${samples[2].toFixed(1)} ms (${samples.map(n => n.toFixed(1)).join(', ')})`);
}
runtime.dispose();
