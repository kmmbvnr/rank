import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';
const source = readFileSync(new URL('../demos/euler/008_seriesproduct.ra', import.meta.url), 'utf8');
const results = [];
for (const size of [0, 13, 1000, 10000, 100000]) {
  const items = Array.from({ length: size }, (_, i) => BigInt(i % 97 === 0 ? 0 : 1 + i * 7 % 9));
  let expected = 0n;
  for (let i = 0; i + 13 <= size; i++) {
    let product = 1n;
    for (let j = 0; j < 13; j++) product *= items[i + j];
    if (product > expected) expected = product;
  }
  // Empty-window behavior is tested in the test suite; this benchmark chooses
  // a nonempty reduction domain.
  if (size < 13) continue;
  const cases = [false, true].map(tensorFusion => {
    const runtime = new Interpreter(() => {}, { tensorFusion });
    runtime.execute('use sequences\nuse numbers\nfun largest Digits\n  Windows = Digits 13 window\n  Products = Windows * reduce rank 1\n  return Products max\nend');
    const input = { kind: 'array', shape: [size], items };
    const call = () => runtime.variables.get('largest').call([input]);
    return { runtime, tensorFusion, call, samplesMs: [] };
  });
  for (const c of cases) for (let i = 0; i < 3; i++) assert.equal(c.call(), expected);
  for (let i = 0; i < 7; i++) for (const c of i % 2 ? [...cases].reverse() : cases) {
    const start = performance.now();
    const value = c.call();
    c.samplesMs.push(performance.now() - start);
    assert.equal(value, expected);
  }
  for (const c of cases) {
    results.push({ fixture: 'window product max', size, tensorFusion: c.tensorFusion, samplesMs: c.samplesMs });
    c.runtime.dispose();
  }
}
const cases = [false, true].map(tensorFusion => ({
  runtime: new Interpreter(() => {}, { tensorFusion }), tensorFusion, samplesMs: [],
}));
for (const c of cases) for (let i = 0; i < 3; i++) assert.equal(c.runtime.execute(source), 23514624000n);
for (let i = 0; i < 9; i++) for (const c of i % 2 ? [...cases].reverse() : cases) {
  const start = performance.now();
  const value = c.runtime.execute(source);
  c.samplesMs.push(performance.now() - start);
  assert.equal(value, 23514624000n);
}
for (const c of cases) {
  results.push({ fixture: 'unchanged Euler 8 with parsing', size: 1000,
    tensorFusion: c.tensorFusion, samplesMs: c.samplesMs });
  c.runtime.dispose();
}
console.log(JSON.stringify({ node: process.version,
  sourceHash: createHash('sha256').update(source).digest('hex'), results }, null, 2));
