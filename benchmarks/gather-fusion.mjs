import assert from 'node:assert/strict';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  checkout: { type: 'string', default: fileURLToPath(new URL('..', import.meta.url)) },
  fusion: { type: 'string', default: 'on' },
  iterations: { type: 'string', default: '1000' },
  samples: { type: 'string', default: '5' },
  profile: { type: 'string' },
  output: { type: 'string' },
  selector: { type: 'string', default: 'lazy' },
} });
assert(['on', 'off'].includes(values.fusion));
assert(['lazy', 'materialized'].includes(values.selector));
assert(!values.profile || ['cpu', 'allocation'].includes(values.profile));
assert(!values.profile || values.output, 'profiling requires --output');
const iterations = Number(values.iterations), samples = Number(values.samples);
assert(Number.isSafeInteger(iterations) && iterations > 0);
assert(Number.isSafeInteger(samples) && samples > 0);
const { Interpreter } = await import(pathToFileURL(resolve(values.checkout, 'packages/interpreter/out/index.js')));
let kernels = 0;
const generated = [];
const runtime = new Interpreter(undefined, {
  tensorFusion: values.fusion === 'on',
  onTensorKernelExecuted: () => kernels++,
  onTensorKernelCompiled: source => generated.push(source),
});
const gc = [];
const observer = new PerformanceObserver(list => gc.push(...list.getEntries().map(entry => ({
  duration: entry.duration, kind: entry.detail.kind,
}))));
observer.observe({ entryTypes: ['gc'] });
const drain = () => new Promise(done => setTimeout(done, 20));
try {
  runtime.execute(`use sequences
use bits
fun Cipher Weights Key Slots Iterations score_many
  Score = 0
  for Iter in 0 till Iterations
    KeyStream = Key Slots
    Plain = Cipher bxor KeyStream
    Score = Weights Plain sum
  end
  return Score
end
Cipher = ((0 till 1455) mod 128) copy
Weights = (((0 till 128) ** 2) + 1) copy
Key = array 101 120 112
Slots = ${values.selector === 'materialized' ? '((0 till 1455) mod 3) copy' : '(0 till 1455) mod 3'}`);
  const fn = runtime.variables.get('score_many');
  assert.equal(fn.kind, 'function');
  const args = ['Cipher', 'Weights', 'Key', 'Slots'].map(name => runtime.variables.get(name));
  const expected = Array.from({ length: 1455 }, (_, i) => {
    const plain = (i % 128) ^ [101, 120, 112][i % 3];
    return BigInt(plain * plain + 1);
  }).reduce((sum, value) => sum + value, 0n);
  assert.equal(fn.call([...args, 20n]), expected);
  // Timings, CPU profiles and allocation sampling are deliberately separate runs.
  let session;
  if (values.profile) {
    session = new Session();
    session.connect();
    if (values.profile === 'cpu') {
      await session.post('Profiler.enable');
      await session.post('Profiler.start');
    } else {
      await session.post('HeapProfiler.startSampling', {
        samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
      });
    }
  }
  const records = [];
  for (let sample = 0; sample < (values.profile ? 1 : samples); sample++) {
    await drain();
    gc.length = 0;
    const beforeKernels = kernels, cpu = process.cpuUsage(), start = performance.now();
    const result = fn.call([...args, BigInt(iterations)]);
    const ms = performance.now() - start, used = process.cpuUsage(cpu);
    assert.equal(result, expected);
    await drain();
    records.push({ sample, ms, cpuMs: (used.user + used.system) / 1000,
      kernels: kernels - beforeKernels, gcCount: gc.length, gcMs: gc.reduce((sum, entry) => sum + entry.duration, 0) });
  }
  let profileSummary;
  if (session) {
    const { profile } = await session.post(values.profile === 'cpu' ? 'Profiler.stop' : 'HeapProfiler.stopSampling');
    writeFileSync(values.output, JSON.stringify(profile));
    if (values.profile === 'allocation') {
      const bytes = node => node.selfSize + node.children.reduce((sum, child) => sum + bytes(child), 0);
      profileSummary = { sampledAllocatedBytes: bytes(profile.head), note: 'V8 sampling estimate including collected objects, not peak or retained heap' };
    }
    session.disconnect();
  }
  console.log(JSON.stringify({ checkout: values.checkout, node: process.version, fusion: values.fusion,
    selector: values.selector, iterations, expected: String(expected), records,
    generatedKernels: generated.length, generated, profileSummary }, null, 2));
} finally { observer.disconnect(); runtime.dispose(); }
