import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
import { ownedArray } from '../packages/interpreter/out/array-storage.js';

const size = Number(process.argv[2] ?? 65536);
const calls = Number(process.argv[3] ?? 8);
assert(Number.isSafeInteger(size) && size >= 2);
assert(Number.isSafeInteger(calls) && calls > 0);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const runtime = new Interpreter();
try {
  runtime.execute(`fun A change
 A 0 = 9
 return A
end
fun A forward
 First = A 0
 return A change
end
fun A forward_parameter I
 First = A (I + 1)
 return A change
end
fun A forward_local
 I = 0
 First = A (I + 1)
 return A change
end`);
  const transferLastUses = runtime.functions.transferLastUses.bind(runtime.functions);
  const cases = ['literal', 'parameter', 'local'].flatMap(selector => [false, true].map(transfer => ({
    selector, transfer, fn: runtime.variables.get(selector === 'literal' ? 'forward' : `forward_${selector}`),
    times: [], copies: [], copiedCells: [],
  })));
  const measure = item => {
    runtime.functions.transferLastUses = item.transfer ? transferLastUses : () => {};
    const inputs = Array.from({ length: calls }, () => ownedArray(Array(size).fill(1n)));
    const stats = new RuntimeDiagnostics();
    const start = performance.now();
    const outputs = stats.run(() => inputs.map(input => item.fn.call(item.selector === 'parameter' ? [input, 0n] : [input])));
    const ms = performance.now() - start;
    for (const output of outputs) {
      assert.deepEqual(output.shape, [size]);
      assert.equal(output.items[0], 9n);
      for (let i = 1; i < size; i++) assert.equal(output.items[i], 1n);
    }
    assert.equal(stats.cowCopies, item.transfer ? 0 : calls);
    assert.equal(stats.cowCopiedCells, item.transfer ? 0 : calls * size);
    return { ms, copies: stats.cowCopies, cells: stats.cowCopiedCells };
  };
  for (const item of cases) { measure(item); measure(item); }
  for (let round = 0; round < 9; round++) {
    for (const item of round % 2 ? [...cases].reverse() : cases) {
      const result = measure(item);
      item.times.push(result.ms);
      item.copies.push(result.copies);
      item.copiedCells.push(result.cells);
    }
  }
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, size, calls,
    timing: 'fresh owned inputs prepared outside timing; read one cell then hand off to a writer; two warmups and nine alternating samples per mode; full output validation outside timing',
    control: 'transfer=false disables runtime transferLastUses; parameter and local cases require guarded index proofs',
    results: cases.map(item => ({ selector: item.selector, transfer: item.transfer, medianMs: median(item.times),
      cowCopies: item.copies, cowCopiedCells: item.copiedCells })) }, null, 2));
} finally { runtime.dispose(); }
