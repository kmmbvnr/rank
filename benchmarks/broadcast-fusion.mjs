import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';
const results = [];
for (const rows of [0, 1, 128, 4096, 32768]) {
  const columns = 32;
  const shape = [rows, columns];
  // Arrays must be created by the interpreter: the kernel declines host-owned
  // arrays (no tracked storage), which would silently turn fusion off.
  const setup = `Data = array shape ${rows} ${columns} fill 3
Mean = array shape ${columns} fill 1
Dev = array shape ${columns} fill 2
`;
  const expected = Array.from({ length: rows * columns }, () => 1);
  const cases = [false, true].map(tensorFusion => {
    const runtime = new Interpreter(undefined, { tensorFusion });
    runtime.execute('use sequences\nfun normalize Data Mean Dev\n  Centered = Data - Mean\n  return (Centered / Dev) copy\nend\n' + setup);
    const args = ['Data', 'Mean', 'Dev'].map(name => runtime.variables.get(name));
    const call = () => runtime.variables.get('normalize').call(args);
    const measure = () => {
      const start = performance.now();
      const value = call();
      const cells = value.items;
      const ms = performance.now() - start;
      assert.deepEqual(value.shape, shape);
      assert.deepEqual(cells, expected);
      return ms;
    };
    const coldMs = measure();
    for (let i = 0; i < 3; i++) measure();
    return { runtime, tensorFusion, coldMs, measure, samplesMs: [] };
  });
  for (let i = 0; i < 7; i++) for (const c of i % 2 ? [...cases].reverse() : cases) c.samplesMs.push(c.measure());
  for (const c of cases) {
    results.push({ rows, columns, tensorFusion: c.tensorFusion, coldMs: c.coldMs, samplesMs: c.samplesMs });
    c.runtime.dispose();
  }
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
