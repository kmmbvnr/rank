import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics, createArraySnapshot } from '../packages/interpreter/out/index.js';

const size = Number(process.argv[2] ?? 256);
const samples = Number(process.argv[3] ?? 7);
assert(Number.isSafeInteger(size) && size >= 8 && size % 8 === 0);
assert(Number.isSafeInteger(samples) && samples >= 3);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const array = (items, shape) => createArraySnapshot(items, shape);
const matrix = (rows, cols, cell) => array(
  Array.from({ length: rows * cols }, (_, i) => cell(Math.floor(i / cols), i % cols)), [rows, cols]);

const cases = [
  {
    name: 'gradient', path: 'demos/deepml/015_gd.ra', function: 'linear_regression',
    input: () => {
      const features = 8;
      return [matrix(size, features, (r, c) => Number(r % features === c)),
        array(Array.from({ length: size }, (_, r) => r % features + 1), [size]), 0.5, 20n];
    },
    check: result => {
      assert.deepEqual(result.shape, [8]);
      for (let c = 0; c < 8; c++) {
        const expected = (c + 1) * (1 - (1 - 0.5 / 8) ** 20);
        assert(Math.abs(result.items[c] - expected) < 0.0001);
      }
    },
  },
  {
    name: 'kmeans', path: 'demos/deepml/017_kmeans.ra', function: 'k_means',
    input: () => [matrix(size, 2, (r, c) => (r % 2) * 10 + (Math.floor(r / 2) % 2) * 2 + c),
      2n, matrix(2, 2, (r, c) => r * 10 + c), 5n],
    check: result => assert.deepEqual(result.items, [1, 2, 11, 12]),
  },
  {
    name: 'adam', path: 'demos/deepml/049_adam.ra', function: 'adam_optimizer',
    setup: runtime => runtime.execute('fun gradient X\n return X * 2\nend'),
    input: runtime => [{ kind: 'record', entries: new Map([
      ['parameters', array(Array(size).fill(1.0), [size])],
      ['gradient', runtime.variables.get('gradient')],
    ]), types: new Map([['parameters', 'array'], ['gradient', 'function']]) }],
    check: result => {
      assert.deepEqual(result.shape, [size]);
      for (const item of result.items) assert(Math.abs(item - 0.9900032473478027) < 1e-9);
    },
  },
];

const results = [];
for (const example of cases) {
  const runtime = new Interpreter();
  try {
    runtime.execute(readFileSync(new URL(`../${example.path}`, import.meta.url), 'utf8'));
    example.setup?.(runtime);
    const fn = runtime.variables.get(example.function);
    const measure = () => {
      const args = example.input(runtime);
      const diagnostics = new RuntimeDiagnostics();
      const start = performance.now();
      const result = diagnostics.run(() => {
        const output = fn.call(args);
        const items = output.items;
        for (let i = 0; i < items.length; i++) void items[i];
        return output;
      });
      const ms = performance.now() - start;
      example.check(result);
      return { ms, cowCopies: diagnostics.cowCopies, cowCopiedCells: diagnostics.cowCopiedCells };
    };
    for (let i = 0; i < 2; i++) measure();
    const runs = Array.from({ length: samples }, measure);
    results.push({ name: example.name, source: example.path, size,
      medianMs: median(runs.map(run => run.ms)),
      cowCopies: runs.map(run => run.cowCopies),
      cowCopiedCells: runs.map(run => run.cowCopiedCells) });
  } finally { runtime.dispose(); }
}
console.log(JSON.stringify({ node: process.version,
  timing: 'fresh input per run; input construction excluded; function call and output forcing included; two warmups',
  counters: 'CoW copies only; copied cells are not allocated bytes', results }, null, 2));
