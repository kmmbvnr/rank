import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { values } = parseArgs({ options: {
  checkout: { type: 'string', default: process.cwd() },
  iterations: { type: 'string', default: '1000000' },
  samples: { type: 'string', default: '7' },
} });
const load = path => import(pathToFileURL(resolve(values.checkout, `packages/interpreter/out/${path}.js`)));
const { ownedArray, arrayForWrite, noteArrayBorrow, noteArrayBinding, derivedArray } = await load('array-storage');
const iterations = Number(values.iterations), samples = Number(values.samples);
assert(Number.isSafeInteger(iterations) && iterations > 0 && Number.isSafeInteger(samples) && samples > 0);
const owned = ownedArray([1n, 2n, 3n]);
noteArrayBinding(owned);
const derived = derivedArray([3], [ownedArray([1n, 2n, 3n])], index => BigInt(index));
noteArrayBorrow(derived);
const cases = {
  'owned-write-guard': count => {
    for (let i = 0; i < count; i++) assert.equal(arrayForWrite(owned), undefined);
  },
  'owned-borrow': count => {
    for (let i = 0; i < count; i++) noteArrayBorrow(owned);
  },
  'derived-borrow': count => {
    for (let i = 0; i < count; i++) noteArrayBorrow(derived);
  },
  'new-array-binding': count => {
    for (let i = 0; i < Math.ceil(count / 20); i++) noteArrayBinding(ownedArray([BigInt(i)]));
  },
};
const results = [];
for (const [name, run] of Object.entries(cases)) {
  for (let i = 0; i < 3; i++) run(10000);
  const ms = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    run(iterations);
    ms.push(performance.now() - start);
  }
  results.push({ name, iterations: name === 'new-array-binding' ? Math.ceil(iterations / 20) : iterations, ms });
}
console.log(JSON.stringify({ node: process.version, checkout: values.checkout,
  note: 'Three warmups of 10000 operations per case. Includes a result assertion in write guard. Creation/binding uses iterations / 20 arrays. Microbenchmarks, not end-to-end speedups.', results }, null, 2));
