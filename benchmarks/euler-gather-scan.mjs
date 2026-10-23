import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: {
  checkout: { type: 'string', default: process.cwd() },
  size: { type: 'string', default: '30000000' },
  width: { type: 'string', default: '63244' },
  rounds: { type: 'string', default: '5' },
  samples: { type: 'string', default: '1' },
  worker: { type: 'boolean', default: false },
} });
const size = Number(values.size), width = Number(values.width), rounds = Number(values.rounds), samples = Number(values.samples);
for (const value of [size, width, rounds, samples]) assert(Number.isSafeInteger(value) && value > 0);
assert(size >= width);
if (!values.worker) {
  const results = [];
  for (let sample = 0; sample < samples; sample++) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker',
      '--checkout', values.checkout, '--size', String(size), '--width', String(width), '--rounds', String(rounds)], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    results.push({ sample, ...JSON.parse(child.stdout) });
  }
  console.log(JSON.stringify({ node: process.version, checkout: values.checkout,
    note: 'Issue #415 reproduction; fresh process per sample, no warmup. Total includes Rank input construction. Oracle and result inspection excluded. maxRSS is process peak in KiB.', results }, null, 2));
} else {
  const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(values.checkout, 'packages/interpreter/out/index.js')));
  const runtime = new Interpreter();
  const diagnostics = new RuntimeDiagnostics();
  try {
    const start = performance.now();
    runtime.execute(`use numbers
use sequences
use io
B = ${size}
S = ${width}
Md = 1234567891
Tg = ((0 till B) * 7919 mod S) copy
W = ((0 till B) mod 13 + 1) copy
Pv = array shape S fill 1`);
    const setupMs = performance.now() - start;
    const afterSetup = process.memoryUsage();
    const pipeline = performance.now();
    const result = diagnostics.run(() => runtime.execute(`for R in 1 to ${rounds}
 Va = W * Pv Tg mod Md
 Cs = Va scan + with 0
 Pv = (Cs (0 till S) + R) mod Md
end
Pv sum`));
    const pipelineMs = performance.now() - pipeline;
    const totalMs = performance.now() - start;
    const after = process.memoryUsage(), maxRSSKiB = process.resourceUsage().maxRSS;
    // Only the prefix can affect Pv. Compute it independently with scalar JS
    // BigInt loops, including scan's leading identity cell.
    let previous = Array(width).fill(1n);
    for (let round = 1; round <= rounds; round++) {
      const next = new Array(width);
      let sum = 0n;
      for (let index = 0; index < width; index++) {
        next[index] = (sum + BigInt(round)) % 1234567891n;
        sum += BigInt(index % 13 + 1) * previous[(index * 7919) % width] % 1234567891n;
      }
      previous = next;
    }
    assert.equal(result, previous.reduce((a, b) => a + b, 0n));
    console.log(JSON.stringify({ size, width, rounds, setupMs, pipelineMs, totalMs, maxRSSKiB,
      afterSetup, after, answer: String(result), diagnostics }));
  } finally { runtime.dispose(); }
}
