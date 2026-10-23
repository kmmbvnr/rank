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
const { parse } = await load('index');
const { compileScalarFunction } = await load('scalar-function-kernel');
const iterations = BigInt(values.iterations), samples = Number(values.samples);
assert(iterations > 0n && Number.isSafeInteger(samples) && samples > 0);
const cases = [
  { name: 'cursor-only', body: 'I = -1\nfor I in 0 till N\n I = I\nend\nreturn I', expected: n => n - 1n },
  { name: 'cursor-and-ordinal', body: 'I = -1\nOrd = -1\nfor I Ord in 0 till N\n Ord = Ord\nend\nreturn I + Ord', expected: n => 2n * (n - 1n) },
  { name: 'integer-sum', body: 'Sum = 0\nfor I in 0 till N\n Sum += I\nend\nreturn Sum', expected: n => n * (n - 1n) / 2n },
];
const results = [];
for (const { name, body, expected } of cases) {
  const kernel = compileScalarFunction(parse(`fun N helper\n${body}\nend`).statements[0], undefined, true);
  assert(kernel, name);
  const run = n => kernel.run([n], error => error);
  for (let i = 0; i < 3; i++) assert.equal(run(10000n), expected(10000n));
  const ms = [];
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    const result = run(iterations);
    ms.push(performance.now() - start);
    assert.equal(result, expected(iterations));
  }
  results.push({ name, iterations: String(iterations), ms });
}
console.log(JSON.stringify({ node: process.version, checkout: values.checkout,
  note: 'Direct scalar-function kernel; three 10000-iteration warmups. Checks outside timing. No interpreter parsing or function dispatch in timing.', results }, null, 2));
