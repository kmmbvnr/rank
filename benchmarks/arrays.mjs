import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const options = process.argv.slice(2);
for (const option of options) {
  if (!['--quick', '--json', '--fusion'].includes(option) && !option.startsWith('--module=')) {
    throw new Error(`Unknown option: ${option}`);
  }
}
const moduleOption = options.find(option => option.startsWith('--module='));
const moduleUrl = moduleOption
  ? pathToFileURL(resolve(moduleOption.slice('--module='.length)))
  : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter } = await import(moduleUrl.href);
const quick = options.includes('--quick');
const sizes = quick ? [100] : [100, 10_000, 1_000_000];
const repetitions = quick ? 2 : 5;
const runtime = new Interpreter();
runtime.execute(`
use sequences
use numbers
fun total A B
  return A + reduce
end
fun addition A B
  return A + B
end
fun chain A B
  return A * 2 + B
end
fun chainreduce A B
  return (A * 2 + B) + reduce
end
fun namedreduce A B
  Temp = A * 2 + B
  return Temp + reduce
end
fun reusedreduce A B
  Temp = A * 2 + B
  First = Temp + reduce
  return First + (Temp + reduce)
end
fun prefix A B
  return A + scan
end
fun ordered A B
  return A sort
end
fun rows A B
  return A sum axis 1
end
`);

function revision(directory) {
  try {
    return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const report = {
  metadata: {
    date: new Date().toISOString(), node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    harnessRevision: revision(dirname(fileURLToPath(import.meta.url))),
    runtimeRevision: revision(dirname(fileURLToPath(moduleUrl))),
    module: moduleUrl.href, gc: typeof global.gc === 'function',
    sizes, warmups: 2, repetitions, fusion: options.includes('--fusion'),
    memory: 'post-operation minus pre-operation bytes; before validation; not peak or allocation totals',
  },
  results: [],
};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// Eagerly read every result element inside the timer, including lazy Rank arrays.
function force(value) {
  if (typeof value !== 'object') return value;
  assert.equal(value.kind, 'array');
  return { shape: [...value.shape], items: value.items };
}

try {
  for (const kind of ['integer', 'real', 'mixed']) {
    const number = value => kind === 'real' ? value : BigInt(value);
    const add = (a, b) => typeof a === 'bigint' && typeof b === 'bigint' ? a + b : Number(a) + Number(b);
    const multiply = (a, b) => typeof a === 'bigint' && typeof b === 'bigint' ? a * b : Number(a) * Number(b);
    for (const size of sizes) {
      // Exact quarter fractions keep real correctness checks independent of tolerance.
      const a = Array.from({ length: size }, (_, i) => kind === 'mixed' && i % 2 !== 0
        ? (i * 37) % 101 - 49.75
        : number((i * 37) % 101 - 50) + (kind === 'real' ? 0.25 : 0n));
      const b = Array.from({ length: size }, (_, i) => kind === 'mixed' && i % 2 === 0
        ? (i * 13) % 97 - 48
        : number((i * 13) % 97 - 48));
      const vector = items => ({ kind: 'array', shape: [items.length], items });
      const total = items => items.reduce(add, number(0));
      const mapped = a.map((item, i) => add(multiply(item, number(2)), b[i]));
      let accumulated = number(0);
      const prefix = a.map(item => accumulated = add(accumulated, item));
      const width = 10;
      const rowSums = Array.from({ length: size / width }, (_, row) => total(a.slice(row * width, (row + 1) * width)));
      const cases = [
        ['total', vector(a), total(a)],
        ['addition', vector(a), vector(a.map((item, i) => add(item, b[i])))],
        ['chain', vector(a), vector(mapped)],
        ['chainreduce', vector(a), total(mapped)],
        ['prefix', vector(a), vector(prefix)],
        ['ordered', vector(a), vector([...a].sort((x, y) => x < y ? -1 : x > y ? 1 : 0))],
        ['rows', { kind: 'array', shape: [size / width, width], items: a }, vector(rowSums)],
      ];
      if (options.includes('--fusion')) {
        cases.push(['namedreduce', vector(a), total(mapped)],
          ['reusedreduce', vector(a), add(total(mapped), total(mapped))]);
      }
      for (const [name, input, expectedValue] of cases) {
        const fn = runtime.variables.get(name);
        const args = [input, vector(b)];
        const expected = force(expectedValue);
        for (let warmup = 0; warmup < 2; warmup++) assert.deepStrictEqual(force(fn.call(args)), expected);
        const samples = [];
        for (let sample = 0; sample < repetitions; sample++) {
          global.gc?.();
          const before = process.memoryUsage();
          const start = performance.now();
          let result = force(fn.call(args));
          const ms = performance.now() - start;
          const after = process.memoryUsage();
          assert.deepStrictEqual(result, expected);
          samples.push({ ms, heapUsedDelta: after.heapUsed - before.heapUsed,
            arrayBuffersDelta: after.arrayBuffers - before.arrayBuffers,
            rssDelta: after.rss - before.rss });
          result = undefined;
        }
        const record = { name, kind, size, medianMs: median(samples.map(sample => sample.ms)),
          medianHeapUsedDelta: median(samples.map(sample => sample.heapUsedDelta)),
          medianArrayBuffersDelta: median(samples.map(sample => sample.arrayBuffersDelta)),
          medianRssDelta: median(samples.map(sample => sample.rssDelta)), samples };
        report.results.push(record);
        if (!options.includes('--json')) {
          console.log(`${kind} ${name} n=${size}: ${record.medianMs.toFixed(3)} ms; heap delta ${(record.medianHeapUsedDelta / 2 ** 20).toFixed(2)} MiB`);
        }
      }
    }
  }
} finally {
  runtime.dispose();
}
console.log(JSON.stringify(options.includes('--json') ? report : report.metadata, null, 2));
