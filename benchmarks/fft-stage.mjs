// Isolate one complete DIF stage, including Rank entry/return contracts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
import { typedArray } from '../packages/interpreter/out/array-storage.js';
const { values } = parseArgs({ options: {
  worker: { type: 'string' }, size: { type: 'string', default: '4096' },
  samples: { type: 'string', default: '5' }, output: { type: 'string' },
} });
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const modes = ['rank-control', 'rank', 'js'];
const sizes = [256, 1024, 4096];
const source = readFileSync(new URL('../demos/classic/fft.ra', import.meta.url), 'utf8').split('rem Radix-2')[0];
if (!values.worker) {
  const samples = Number(values.samples);
  assert(Number.isSafeInteger(samples) && samples > 0);
  const results = [];
  for (let trial = 0; trial < samples; trial++) for (const n of sizes) {
    for (const mode of trial % 2 ? [...modes].reverse() : modes) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${mode}`, `--size=${n}`], { encoding: 'utf8', timeout: 60000 });
      assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
      results.push({ trial, ...JSON.parse(child.stdout) });
    }
    process.stderr.write(`stage ${trial + 1}/${values.samples}, N=${n}\n`);
  }
  const summary = sizes.flatMap(n => modes.map(mode => {
    const rows = results.filter(r => r.n === n && r.mode === mode);
    return { n, mode, medianMs: median(rows.map(r => r.ms)), cpuMedianMs: median(rows.map(r => r.cpuMs)),
      minMs: Math.min(...rows.map(r => r.ms)), maxMs: Math.max(...rows.map(r => r.ms)) };
  }));
  const report = { date: new Date().toISOString(), node: process.version, cpu: cpus()[0].model,
    sourceHash: createHash('sha256').update(source).digest('hex'),
    note: 'serial fresh processes, 300 ms warmup and 150 ms target batch; roots/inputs precomputed outside timing; output allocation and Rank call/return validation included; ordinary bindings complete all output cells, boxing to host arrays excluded; stage width N/4',
    results, summary };
  if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} else {
  const mode = values.worker, n = Number(values.size), size = n / 4;
  assert(modes.includes(mode)); assert(Number.isInteger(size) && size >= 2);
  const r = Float64Array.from({ length: n }, (_, i) => Math.sin(i * .71) + .2 * Math.cos(i * .13));
  const im = Float64Array.from({ length: n }, (_, i) => .3 * Math.cos(i * .37));
  const c = Float64Array.from({ length: n / 2 }, (_, i) => Math.cos(-2 * Math.PI * i / n));
  const s = Float64Array.from({ length: n / 2 }, (_, i) => Math.sin(-2 * Math.PI * i / n));
  const js = () => {
    const re = new Float64Array(n), imaginary = new Float64Array(n), h = size / 2, stride = n / size;
    for (let start = 0; start < n; start += size) for (let k = 0; k < h; k++) {
      const lo = start + k, hi = lo + h, w = k * stride;
      const ur = r[lo], vr = r[hi], ui = im[lo], vi = im[hi];
      re[lo] = ur + vr; imaginary[lo] = ui + vi;
      const dr = ur - vr, di = ui - vi;
      re[hi] = dr * c[w] - di * s[w]; imaginary[hi] = dr * s[w] + di * c[w];
    }
    return [re, imaginary];
  };
  const runtime = mode === 'js' ? undefined : new Interpreter(() => {}, { arrayFunctionCompilation: mode === 'rank' });
  runtime?.execute(source);
  const args = [r, im, c, s].map(a => typedArray(a.slice())); args.push(BigInt(size));
  const fn = runtime?.variables.get('fftStage');
  const run = runtime ? () => fn.call(args).items : js;
  const expected = js();
  const check = result => { for (let p = 0; p < 2; p++) { const cells = result[p].kind === 'array' ? result[p].items : result[p]; for (let i = 0; i < n; i++) assert(Math.abs(cells[i] - expected[p][i]) < 1e-12); } };
  check(run());
  const warm = performance.now(); let count = 0;
  while (performance.now() - warm < 300 || count < 3) { run(); count++; }
  const probe = performance.now(); run();
  const iterations = Math.max(3, Math.ceil(150 / Math.max(.001, performance.now() - probe)));
  const cpu = process.cpuUsage(), start = performance.now(); let result;
  for (let i = 0; i < iterations; i++) result = run();
  const ms = (performance.now() - start) / iterations, used = process.cpuUsage(cpu);
  check(result);
  const diagnostics = new RuntimeDiagnostics(); if (runtime) diagnostics.run(run);
  console.log(JSON.stringify({ n, size, mode, iterations, ms, cpuMs: (used.user + used.system) / 1000 / iterations,
    numericCalls: diagnostics.compiledArrayFunctions }));
  runtime?.dispose();
}
