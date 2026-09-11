import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(module|samples)=(.+)$/.exec(arg);
  assert(match, `Unknown option ${arg}`);
  return [match[1], match[2]];
}));
assert(global.gc, 'Run with node --expose-gc');
const moduleUrl = options.module ? pathToFileURL(resolve(options.module))
  : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { createArraySnapshot } = await import(moduleUrl.href);
const samples = Number(options.samples ?? 5);
assert(Number.isSafeInteger(samples) && samples >= 3);
const revision = directory => execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const report = { metadata: { date: new Date().toISOString(), node: process.version,
  cpu: cpus()[0]?.model, module: moduleUrl.href,
  revision: revision(dirname(fileURLToPath(moduleUrl))), samples,
  timing: 'constructor, or constructor plus first public exposure; host source allocated before timing',
  memory: 'retained deltas after forced GC, before validation; not peak allocation' }, results: [] };

for (const kind of ['real', 'boolean', 'integer', 'mixed']) {
  for (const size of [100, 1_000_000]) {
    const source = Array.from({ length: size }, (_, i) => kind === 'boolean' ? i % 2 === 0
      : kind === 'integer' ? BigInt(i) : kind === 'mixed' && i % 2 === 0 ? BigInt(i) : i / 4);
    for (const mode of ['private', 'exposed']) {
      const run = () => {
        const value = createArraySnapshot(source);
        if (mode === 'exposed') void value.items;
        return value;
      };
      for (let i = 0; i < 2; i++) assert.deepEqual(run().items, source);
      const measurements = [];
      for (let i = 0; i < samples; i++) {
        global.gc();
        const before = process.memoryUsage();
        const start = performance.now();
        let value = run();
        const ms = performance.now() - start;
        global.gc();
        const after = process.memoryUsage();
        measurements.push({ ms, heapDelta: after.heapUsed - before.heapUsed,
          buffersDelta: after.arrayBuffers - before.arrayBuffers });
        assert.deepEqual(value.items, source);
        value = undefined;
      }
      const result = { kind, size, mode, medianMs: median(measurements.map(x => x.ms)),
        medianHeapDelta: median(measurements.map(x => x.heapDelta)),
        medianBuffersDelta: median(measurements.map(x => x.buffersDelta)), samples: measurements };
      report.results.push(result);
      console.error(`${kind} ${mode}/${size}: ${result.medianMs.toFixed(2)} ms`);
    }
  }
}
console.log(JSON.stringify(report, null, 2));
