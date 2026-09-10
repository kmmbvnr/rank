import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';

// Parse once; measure repeated execution of the same recursive function.
const runtime = new Interpreter();
runtime.execute(`
fun tree N
  if N equal 0
    return 1
  end
  return ((N - 1) tree) + ((N - 1) tree)
end
`);
const tree = runtime.variables.get('tree');
for (let i = 0; i < 2; i++) tree.call([10n]);
const samples = [];
for (let i = 0; i < 5; i++) {
  const start = performance.now();
  assert.equal(tree.call([14n]), 16384n);
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(`recursive tree: median ${samples[2].toFixed(1)} ms (${samples.map(n => n.toFixed(1)).join(', ')})`);
runtime.dispose();
