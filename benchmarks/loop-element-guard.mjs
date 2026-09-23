import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createArraySnapshot, Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const size = Number(process.argv[2] ?? 200000);
const calls = Number(process.argv[3] ?? 200);
assert(Number.isSafeInteger(size) && size > 0);
assert(Number.isSafeInteger(calls) && calls > 0);

const runtime = new Interpreter();
try {
  runtime.execute(`fun first A
 for I in 0 until 1
  return A I
 end
 return 0
end`);
  const input = createArraySnapshot(Array(size).fill(7n));
  const first = runtime.variables.get('first');
  const diagnostics = new RuntimeDiagnostics();
  const run = () => assert.equal(first.call([input]), 7n);
  for (let i = 0; i < 3; i++) diagnostics.run(run);
  const start = performance.now();
  for (let i = 0; i < calls; i++) diagnostics.run(run);
  const elapsedMs = performance.now() - start;
  assert.equal(diagnostics.loopElementScans, 1);
  assert.equal(diagnostics.compiledLoops, calls + 3);
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
    size, calls, elapsedMs, loopElementScans: diagnostics.loopElementScans,
    compiledLoops: diagnostics.compiledLoops,
    timing: 'three warmups, then repeated calls on the same owned array; input creation excluded' }, null, 2));
} finally { runtime.dispose(); }
