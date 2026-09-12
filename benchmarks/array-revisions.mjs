import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { denseSource, denseCases } from './dense-write-cases.mjs';
const baseline = process.argv[2];
if (!baseline) throw Error('Pass the baseline checkout path');
const checkouts = { candidate: process.cwd(), baseline: resolve(baseline) };
const results = {}, cases = {};
const pcaSource = readFileSync(new URL('../demos/deepml/019_pca.ra', import.meta.url), 'utf8');
for (const [name, checkout] of Object.entries(checkouts)) {
  const { Interpreter, createArraySnapshot } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
  const runtime = new Interpreter();
  runtime.execute(`use sequences
use stats
fun polynomial A
  return (A * A + A * 2.0 + 1.0) copy
end
fun columns A
  return A mean axis 0
end
${denseSource}`);
  const input = createArraySnapshot(Array.from({ length: 1000000 }, (_, i) => i % 100 / 8));
  const matrix = createArraySnapshot(Array.from({ length: 2048 * 2 }, (_, i) => i % 4), [2048, 2]);
  runtime.execute(pcaSource);
  const pcaInput = createArraySnapshot(Array.from({ length: 2048 * 2 }, (_, i) => Math.floor(i / 2) + i % 2), [2048, 2]);
  const polynomial = runtime.variables.get('polynomial');
  const means = runtime.variables.get('columns').call([matrix]);
  const tasks = {
    copy: () => { const result = polynomial.call([input]); assert.equal(result.items[0], 1); },
    repeatedColumns: () => { for (let i = 0; i < 2048; i++) assert.equal(means.itemAt(0), 1); },
    pca2048: () => {
      const result = runtime.variables.get('pca').call([pcaInput, 1n]);
      assert.deepEqual(result.shape, [2, 1]);
      assert.deepEqual(result.items, [0.7071, 0.7071]);
    },
  };
  for (const [task, args, expected] of denseCases) {
    tasks[task] = () => assert.equal(runtime.variables.get(task).call(args), expected);
  }
  cases[name] = { runtime, tasks };
  results[name] = { commit: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tasks: {} };
}
for (const task of Object.keys(cases.candidate.tasks)) {
  for (const name of Object.keys(cases)) {
    const run = cases[name].tasks[task];
    const start = performance.now(); run();
    results[name].tasks[task] = { coldMs: performance.now() - start, samples: [] };
    // Warm up at the measured size, including the dense loop's runtime guards.
    for (let i = 0; i < 3; i++) run();
  }
  for (let sample = 0; sample < 9; sample++) {
    const order = sample % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const name of order) {
      const start = performance.now(); cases[name].tasks[task]();
      results[name].tasks[task].samples.push(performance.now() - start);
    }
  }
  for (const name of Object.keys(cases)) {
    const result = results[name].tasks[task];
    result.median = [...result.samples].sort((a, b) => a - b)[4];
  }
}
for (const { runtime } of Object.values(cases)) runtime.dispose();
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
  timing: 'parse once; full-size warmup; alternating checkout order; nine samples', results }, null, 2));
