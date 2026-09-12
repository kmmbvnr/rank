import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Interpreter } from '../packages/interpreter/out/index.js';

const name = process.argv[2] ?? 'pca';
const repeat = Number(process.env.REPEAT ?? 5);
const rows = Number(process.env.ROWS ?? 2048);
const array = (items, shape) => ({ kind: 'array', items, shape });
const paths = { pca: 'demos/deepml/019_pca.ra', gradient: 'demos/deepml/015_gd.ra',
  windows: 'demos/euler/008_seriesproduct.ra' };
assert(name in paths);
const source = readFileSync(new URL('../' + paths[name], import.meta.url), 'utf8');
const tensorFusion = process.env.TENSOR_FUSION !== 'off';
const runtime = new Interpreter(() => {}, { tensorFusion });
let call, check;
if (name === 'windows') {
  call = () => runtime.execute(source);
  check = value => assert.equal(value, 23514624000n);
} else {
  runtime.execute(source);
  if (name === 'pca') {
    const data = array(Array.from({ length: rows * 2 }, (_, i) => Math.floor(i / 2) + i % 2), [rows, 2]);
    call = () => runtime.variables.get('pca').call([data, 1n]);
    check = value => {
      assert.deepEqual(value.shape, [2, 1]);
      assert.deepEqual(value.items, [0.7071, 0.7071]);
    };
  } else {
    const features = 8, steps = 20, rate = 0.5;
    const x = array(Array.from({ length: rows * features }, (_, i) =>
      Number(Math.floor(i / features) % features === i % features)), [rows, features]);
    const y = array(Array.from({ length: rows }, (_, i) => i % features + 1), [rows]);
    call = () => runtime.variables.get('linear_regression').call([x, y, rate, BigInt(steps)]);
    check = value => {
      assert.deepEqual(value.shape, [features]);
      value.items.forEach((v, c) => {
        const count = Math.floor(rows / features) + Number(c < rows % features);
        const expected = (c + 1) * (1 - (1 - rate * count / rows) ** steps);
        assert(Math.abs(v - expected) <= 0.00005);
      });
    };
  }
}
function measure() {
  const start = performance.now();
  const value = call();
  if (value?.kind === 'array') void value.items;
  const ms = performance.now() - start;
  check(value);
  return ms;
}
try {
  const coldMs = measure();
  for (let i = 0; i < 3; i++) measure();
  const samplesMs = Array.from({ length: repeat }, measure);
  console.log(JSON.stringify({ name, tensorFusion, rows: name === 'windows' ? undefined : rows,
    path: paths[name], sourceHash: createHash('sha256').update(source).digest('hex'),
    node: process.version, coldMs, samplesMs, memory: process.memoryUsage() }, null, 2));
} finally { runtime.dispose(); }
