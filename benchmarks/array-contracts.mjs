import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { values } = parseArgs({ options: {
  checkout: { type: 'string', default: process.cwd() },
  iterations: { type: 'string', default: '100000' },
  samples: { type: 'string', default: '7' },
} });
const load = path => import(pathToFileURL(resolve(values.checkout, `packages/interpreter/out/${path}.js`)));
const { ArrayBindingContract } = await load('array-binding-contract');
const { ownedArray } = await load('array-storage');
const iterations = Number(values.iterations), samples = Number(values.samples);
assert(Number.isSafeInteger(iterations) && iterations > 0 && Number.isSafeInteger(samples) && samples > 0);
const scalar = ownedArray([1n, 2n, 3n, 4n]);
let nested = scalar;
for (let i = 0; i < 16; i++) nested = ownedArray([nested]);
const check = new ArrayBindingContract('check');
const copy = new ArrayBindingContract('copy');
copy.check(nested);
const retained = [];
const cases = {
  'scalar-check': count => {
    for (let i = 0; i < count; i++) check.check(scalar);
  },
  'nested-contract-copy': count => {
    for (let i = 0; i < count; i++) retained[i % 1024] = copy.copy();
  },
};
const results = [];
for (const [name, run] of Object.entries(cases)) {
  for (let i = 0; i < 3; i++) run(1000);
  const ms = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    run(iterations);
    ms.push(performance.now() - start);
  }
  results.push({ name, iterations, ms });
}
assert.equal(retained.length, 1024);
console.log(JSON.stringify({ node: process.version, checkout: values.checkout,
  note: 'Three 1000-operation warmups. Copies retain a ring of 1024 bindings. Microbenchmarks; setup excluded.', results }, null, 2));
