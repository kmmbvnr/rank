import assert from 'node:assert/strict';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const match = /^--(baseline|checkout|runs)=(.+)$/.exec(argument);
  assert(match, `Unknown argument: ${argument}`);
  return [match[1], match[2]];
}));
if (options.baseline) {
  const runs = Number(options.runs ?? 3);
  assert(Number.isSafeInteger(runs) && runs > 0);
  const checkouts = { baseline: resolve(options.baseline), candidate: root };
  const results = [];
  for (let run = 0; run < runs; run++) {
    for (const version of run % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const report = JSON.parse(execFileSync(process.execPath,
        [fileURLToPath(import.meta.url), `--checkout=${checkouts[version]}`], { encoding: 'utf8' }));
      results.push({ run, version, ...report });
    }
  }
  console.log(JSON.stringify({ checkouts, results }, null, 2));
} else {
  const { Interpreter } = await import(pathToFileURL(resolve(options.checkout ?? root, 'packages/interpreter/out/index.js')));

  // Run each build in a separate process; alternate baseline/candidate processes.
  // CPU profiling should be a separate run, not the timing comparison.
  const calls = Number(process.env.CALLS ?? 10000);
  const rowsList = (process.env.ROWS ?? '1,8,128').split(',').map(Number);
  assert(Number.isSafeInteger(calls) && calls > 0);
  const gc = [];
  const observer = new PerformanceObserver(list => gc.push(...list.getEntries()));
  observer.observe({ entryTypes: ['gc'] });
  const drain = () => new Promise(resolve => setTimeout(resolve, 20));
  const results = [];
  for (const rows of rowsList) {
    assert(Number.isSafeInteger(rows) && rows >= 0);
    let executions = 0;
    const runtime = new Interpreter(undefined, { onTensorKernelExecuted: () => executions++ });
    runtime.execute(`use sequences
fun normalize Data Mean Dev
  Centered = Data - Mean
  return (Centered / Dev) copy
end
Data = array shape ${rows} 32 fill 3
Mean = array shape 32 fill 1
Dev = array shape 32 fill 2`);
    const fn = runtime.variables.get('normalize');
    const args = ['Data', 'Mean', 'Dev'].map(name => runtime.variables.get(name));
    const check = value => {
      assert.deepEqual(value.shape, [rows, 32]);
      assert.deepEqual(value.items, Array(rows * 32).fill(1));
    };
    check(fn.call(args));
    assert.equal(executions, 1, 'benchmark must execute the fused kernel');
    for (let i = 0; i < 2000; i++) fn.call(args);
    const samples = [];
    for (let sample = 0; sample < 7; sample++) {
      await drain();
      const cpu = process.cpuUsage();
      const start = performance.now();
      let result;
      for (let i = 0; i < calls; i++) result = fn.call(args);
      const end = performance.now();
      const usedCpu = process.cpuUsage(cpu);
      await drain();
      check(result);
      const collections = gc.filter(entry => entry.startTime >= start && entry.startTime < end);
      samples.push({ usPerCall: (end - start) * 1000 / calls,
        cpuUsPerCall: (usedCpu.user + usedCpu.system) / calls,
        gcCount: collections.length, gcMs: collections.reduce((sum, entry) => sum + entry.duration, 0) });
    }
    results.push({ rows, calls, medianUs: samples.map(s => s.usPerCall).sort((a, b) => a - b)[3], samples });
    runtime.dispose();
  }
  observer.disconnect();
  console.log(JSON.stringify({ node: process.version, results }, null, 2));
}
