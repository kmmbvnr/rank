import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const source = `use ranges
fun total B N
  Total = 0
  for I in 0 until N
    Total += B (I % 10000)
  end
  return Total
end
A = (1 to 10000) array
B = A * 2`;
const cases = [false, true].map(tensorReadHoisting => {
  const runtime = new Interpreter(undefined, { tensorReadHoisting });
  runtime.execute(source);
  const input = runtime.variables.get('B');
  input.items;
  const run = () => assert.equal(runtime.variables.get('total').call([input, 1000000n]), 10001000000n);
  for (let i = 0; i < 3; i++) run();
  return { runtime, run, enabled: tensorReadHoisting, samples: [] };
});
for (let i = 0; i < 9; i++) {
  for (const task of i % 2 ? [...cases].reverse() : cases) {
    const start = performance.now(); task.run(); task.samples.push(performance.now() - start);
  }
}
const results = cases.map(({ runtime, enabled, samples }) => {
  runtime.dispose();
  const diagnostics = new RuntimeDiagnostics();
  const measured = new Interpreter(undefined, { tensorReadHoisting: enabled });
  try {
    diagnostics.run(() => {
      measured.execute(source);
      const input = measured.variables.get('B');
      input.items;
      assert.equal(measured.variables.get('total').call([input, 1000000n]), 10001000000n);
    });
  } finally { measured.dispose(); }
  return { enabled, samples, medianMs: [...samples].sort((a,b) => a-b)[4], diagnostics };
});
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
  timing: 'warm, alternating, nine samples; diagnostics collected in separate runs', results }, null, 2));
