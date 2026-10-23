import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  checkout: { type: 'string', default: fileURLToPath(new URL('..', import.meta.url)) },
  size: { type: 'string', default: '10000000' },
  rounds: { type: 'string', default: '10' },
  samples: { type: 'string', default: '3' },
  worker: { type: 'boolean', default: false },
} });
const size = Number(values.size), rounds = Number(values.rounds), samples = Number(values.samples);
for (const value of [size, rounds, samples]) assert(Number.isSafeInteger(value) && value > 0);
// Keep the independent Number oracle exact, including the index multiplication.
assert(Number.isSafeInteger(size * size) && Number.isSafeInteger(size * 7919));

if (!values.worker) {
  const results = [];
  for (let sample = 0; sample < samples; sample++) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker',
      '--checkout', values.checkout, '--size', String(size), '--rounds', String(rounds)], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    results.push({ sample, ...JSON.parse(child.stdout) });
  }
  const median = key => results.map(result => result[key]).sort((a, b) => a - b)[Math.floor(samples / 2)];
  console.log(JSON.stringify({ node: process.version, checkout: values.checkout,
    note: 'Issue #421; fresh processes, no warmup. Gather time includes the B sums; total includes input construction. Oracle excluded.',
    results, medianGatherMs: median('gatherMs'), medianTotalMs: median('totalMs') }, null, 2));
} else {
  const { Interpreter } = await import(pathToFileURL(resolve(values.checkout, 'packages/interpreter/out/index.js')));
  const runtime = new Interpreter();
  try {
    const start = performance.now();
    runtime.execute(`use sequences
N = ${size}
A = (0 till N) copy
Ix = A * 7919 mod N
X = Ix sum
X += A sum`);
    const setupMs = performance.now() - start;
    const gatherStart = performance.now();
    const answer = runtime.execute(`for I in 1 to ${rounds}
  B = A Ix
  X += B sum
end
X`);
    const gatherMs = performance.now() - gatherStart, totalMs = performance.now() - start;
    let indexSum = 0;
    for (let index = 0; index < size; index++) indexSum += index * 7919 % size;
    const expected = BigInt(rounds + 1) * BigInt(indexSum) + BigInt(size) * BigInt(size - 1) / 2n;
    assert.equal(answer, expected);
    console.log(JSON.stringify({ size, rounds, setupMs, gatherMs, totalMs, answer: String(answer) }));
  } finally { runtime.dispose(); }
}
