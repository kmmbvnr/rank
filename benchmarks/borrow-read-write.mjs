import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
import { arrayForWrite, noteArrayBinding, ownedArray } from '../packages/interpreter/out/array-storage.js';

const size = Number(process.argv[2] ?? 65536);
const calls = Number(process.argv[3] ?? 64);
assert(Number.isSafeInteger(size) && size >= 2);
assert(Number.isSafeInteger(calls) && calls > 0);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const runtime = new Interpreter();
try {
  runtime.execute(`fun borrowed V I
 return V (I + 1)
end
fun local V I
 J = I + 1
 return V J
end
fun cell V I
 Cell = V (I + 1)
 return Cell
end
fun readat V I
 return V I
end
fun helper_cell V I
 Cell = V (I + 1) readat
 return Cell
end
fun quotient V I
 J = I + 1
 return V (J // 1)
end
fun branch V Flag
 if Flag
  return V 1
 else
  return V 0
 end
end
fun branch_local V Flag
 if Flag
  Cell = V 0
 else
  Cell = V 1
 end
 return Cell
end
fun scan V N
 Total = 0
 for I in 0 until N
  Total += V I
 end
 return Total
end
fun fallback_scan V N
 Total = 0
 for I in 0 until N
  Total += V (I ** 1)
 end
 return Total
end
fun fallback V I
 J = I + 1
 return V (J ** 1)
end`);
  const cases = ['borrowed', 'local', 'cell', 'helper_cell', 'quotient', 'branch', 'branch_local', 'scan', 'fallback_scan', 'fallback'].map(name => ({
    name, fn: runtime.variables.get(name), samples: [], copies: [], copiedCells: [],
  }));
  const measure = item => {
    const inputs = Array.from({ length: calls }, () => {
      const value = ownedArray(Array(size).fill(0n));
      noteArrayBinding(value);
      return value;
    });
    const stats = new RuntimeDiagnostics();
    const start = performance.now();
    stats.run(() => {
      for (const input of inputs) {
        assert.equal(item.fn.call([input, item.name.startsWith('branch') ? true
          : item.name.includes('scan') ? 2n : 0n]), 0n);
        const writable = arrayForWrite(input) ?? input;
        writable.items[0] = 1n;
        assert.equal(writable.items[0], 1n);
        assert.equal(input.items[1], 0n);
      }
    });
    return { ms: performance.now() - start, copies: stats.cowCopies, copiedCells: stats.cowCopiedCells };
  };
  for (const item of cases) {
    measure(item);
    measure(item);
  }
  for (let round = 0; round < 9; round++) {
    for (const item of round % 2 ? [...cases].reverse() : cases) {
      const result = measure(item);
      item.samples.push(result.ms);
      item.copies.push(result.copies);
      item.copiedCells.push(result.copiedCells);
    }
  }
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, size, calls,
    timing: 'fresh owned inputs prepared outside timing; reader call, CoW check and one cell write inside; two warmups, nine alternating samples',
    caveat: 'the fallback control computes the same index with exponentiation; times do not isolate borrow-proof overhead',
    results: cases.map(item => ({ name: item.name, medianMs: median(item.samples),
      cowCopies: item.copies, cowCopiedCells: item.copiedCells })) }, null, 2));
} finally { runtime.dispose(); }
