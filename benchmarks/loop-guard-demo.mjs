import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createArraySnapshot, Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const size = Number(process.argv[2] ?? 20000);
const calls = Number(process.argv[3] ?? 100);
assert(Number.isSafeInteger(size) && size > 0);
assert(Number.isSafeInteger(calls) && calls > 0);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const runtime = new Interpreter(() => {}, { input: { readToken: () => '1' } });
try {
  runtime.execute(readFileSync(new URL('../demos/cses/sortnsrch/008_maxsubarray.ra', import.meta.url), 'utf8'));
  const maxSubarray = runtime.variables.get('max_subarray');
  const items = Array.from({ length: size }, (_, i) => BigInt(i % 100 - 50));
  let current = items[0], expected = items[0];
  for (const item of items.slice(1)) {
    current = item > current + item ? item : current + item;
    if (current > expected) expected = current;
  }
  const stable = createArraySnapshot(items);
  const cases = [{ name: 'same-array', samples: [], scans: [] },
    { name: 'fresh-arrays', samples: [], scans: [] }];
  const measure = (entry, record) => {
    const inputs = entry.name === 'same-array' ? Array(calls).fill(stable)
      : Array.from({ length: calls }, () => createArraySnapshot(items));
    const diagnostics = new RuntimeDiagnostics();
    const start = performance.now();
    diagnostics.run(() => {
      for (const array of inputs) assert.equal(maxSubarray.call([array]), expected);
    });
    if (record) {
      entry.samples.push(performance.now() - start);
      entry.scans.push(diagnostics.loopElementScans);
    }
  };
  for (const entry of cases) for (let i = 0; i < 2; i++) measure(entry, false);
  for (let round = 0; round < 9; round++) {
    for (const entry of round % 2 ? [...cases].reverse() : cases) measure(entry, true);
  }
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, size, calls,
    timing: 'unchanged CSES Maximum Subarray Sum; arrays prepared outside timing; two warmups and nine alternating batches',
    caveat: 'same versus fresh input identity changes more than the element-check cache',
    results: cases.map(entry => ({ name: entry.name, medianMs: median(entry.samples),
      loopElementScans: entry.scans })) }, null, 2));
} finally { runtime.dispose(); }
