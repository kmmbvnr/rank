import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { Interpreter } = await import('../packages/interpreter/out/index.js');
const { Interpreter: Baseline } = await import(pathToFileURL(resolve(process.argv[2])));
import { denseSource, denseCases } from './dense-write-cases.mjs';
const results = {};
const runtimes = [Baseline, Interpreter].map(Runtime => {
  const r = new Runtime();
  r.execute(denseSource);
  return r;
});
for (const [name, args, expected, warmup] of denseCases) {
  const samples = [[], []];
  for (const r of runtimes) for (let i = 0; i < 3; i++) r.variables.get(name).call(warmup);
  for (let i = 0; i < 9; i++) for (const mode of i % 2 ? [1, 0] : [0, 1]) {
    const t = performance.now();
    const value = runtimes[mode].variables.get(name).call(args);
    samples[mode].push(performance.now() - t);
    assert.equal(value, expected);
  }
  results[name] = samples.map(ms => ({ samples: ms, median: [...ms].sort((a,b)=>a-b)[4] }));
}
for (const r of runtimes) r.dispose();
console.log(JSON.stringify({ node: process.version, note: 'baseline and candidate, alternating order, nine samples including array allocation', baseline: process.argv[2], results }, null, 2));
