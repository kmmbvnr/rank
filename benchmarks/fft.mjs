// FFT timing and profiling; build TypeScript before running.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Session } from 'node:inspector/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { values } = parseArgs({ options: {
  worker: { type: 'string' }, checkout: { type: 'string' }, baseline: { type: 'string' }, modes: { type: 'string' }, size: { type: 'string', default: '4096' },
  samples: { type: 'string', default: '7' }, profile: { type: 'string' },
  output: { type: 'string' }, fftjs: { type: 'string' }, diagnostics: { type: 'boolean', default: false },
} });
const checkout = values.checkout ?? fileURLToPath(new URL('..', import.meta.url));
const { Interpreter, RuntimeDiagnostics, createArraySnapshot } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
const source = readFileSync(new URL('../demos/classic/fft.ra', import.meta.url), 'utf8');
const definitions = source.split('\nX = array')[0];
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sizes = [256, 1024, 4096];
const availableModes = ['compiled', 'reference', 'js-stages', 'js-inplace', ...(values.fftjs ? ['fftjs-setup', 'fftjs-reuse'] : [])];
const modes = values.modes?.split(',') ?? availableModes;
assert(modes.every(mode => availableModes.includes(mode) || mode === 'baseline' && values.baseline), 'unknown mode or missing --baseline');
const FFT = values.fftjs ? createRequire(import.meta.url)(values.fftjs) : undefined;

// Same DIF algorithm, roots, output ordering and per-call preparation as Rank.
// Stages mode retains separate array passes; inplace fuses each butterfly.
function jsFft(input, inplace) {
  const n = input.length;
  let r = Float64Array.from(input), im = new Float64Array(n);
  const c = new Float64Array(n / 2), s = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    const a = -2 * Math.PI * k / n;
    c[k] = Math.cos(a); s[k] = Math.sin(a);
  }
  for (let size = n; size > 1; size /= 2) {
    const h = size / 2, stride = n / size;
    if (inplace) {
      for (let start = 0; start < n; start += size) for (let k = 0; k < h; k++) {
        const lo = start + k, hi = lo + h, w = k * stride;
        const ur = r[lo], ui = im[lo], vr = r[hi], vi = im[hi];
        r[lo] = ur + vr; im[lo] = ui + vi;
        const dr = ur - vr, di = ui - vi;
        r[hi] = dr * c[w] - di * s[w]; im[hi] = dr * s[w] + di * c[w];
      }
    } else {
      const half = n / 2;
      const ur = new Float64Array(half), vr = new Float64Array(half);
      const ui = new Float64Array(half), vi = new Float64Array(half);
      const cc = new Float64Array(h), ss = new Float64Array(h);
      for (let k = 0; k < h; k++) { cc[k] = c[k * stride]; ss[k] = s[k * stride]; }
      for (let q = 0; q < half; q++) {
        const lo = Math.floor(q / h) * size + q % h;
        ur[q] = r[lo]; vr[q] = r[lo + h]; ui[q] = im[lo]; vi[q] = im[lo + h];
      }
      const dr = new Float64Array(half), di = new Float64Array(half);
      for (let q = 0; q < half; q++) dr[q] = ur[q] - vr[q];
      for (let q = 0; q < half; q++) di[q] = ui[q] - vi[q];
      const tr = new Float64Array(half), ti = new Float64Array(half);
      for (let q = 0; q < half; q++) tr[q] = dr[q] * cc[q % h] - di[q] * ss[q % h];
      for (let q = 0; q < half; q++) ti[q] = dr[q] * ss[q % h] + di[q] * cc[q % h];
      const nextR = new Float64Array(n), nextI = new Float64Array(n);
      for (let q = 0; q < half; q++) {
        const lo = Math.floor(q / h) * size + q % h;
        nextR[lo] = ur[q] + vr[q]; nextR[lo + h] = tr[q];
        nextI[lo] = ui[q] + vi[q]; nextI[lo + h] = ti[q];
      }
      r = nextR; im = nextI;
    }
  }
  let index = Uint32Array.from({ length: n }, (_, i) => i), order = new Uint32Array(n);
  for (let bits = n; bits > 1; bits /= 2) {
    for (let j = 0; j < n; j++) order[j] = order[j] * 2 + index[j] % 2;
    for (let j = 0; j < n; j++) index[j] = Math.floor(index[j] / 2);
  }
  return [Float64Array.from(order, j => r[j]), Float64Array.from(order, j => im[j])];
}
function check(got, expected) {
  if (typeof got[0] === 'number') got = [0, 1].map(p => Array.from({ length: got.length / 2 }, (_, j) => got[j * 2 + p]));
  assert.equal(got.length, 2);
  for (let p = 0; p < 2; p++) {
    assert.equal(got[p].length, expected[p].length);
    for (let j = 0; j < got[p].length; j++)
      assert(Math.abs(Number(got[p][j]) - expected[p][j]) < 1e-8 * Math.max(1, Math.abs(expected[p][j])), `${p}/${j}`);
  }
}
function dft(x) {
  return [0, 1].map(p => x.map((_, k) => x.reduce((total, v, j) => {
    const a = -2 * Math.PI * k * j / x.length;
    return total + v * (p ? Math.sin(a) : Math.cos(a));
  }, 0)));
}
function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const parents = new Map();
  for (const node of profile.nodes) for (const id of node.children ?? []) parents.set(id, node.id);
  const self = new Map(), inclusive = new Map();
  for (let j = 0; j < profile.samples.length; j++) {
    const id = profile.samples[j], dt = (profile.timeDeltas[j] ?? 0) / 1000;
    self.set(id, (self.get(id) ?? 0) + dt);
    for (let current = id; current !== undefined; current = parents.get(current))
      inclusive.set(current, (inclusive.get(current) ?? 0) + dt);
  }
  const aggregate = entries => {
    const sums = new Map();
    for (const [id, ms] of entries) {
      const f = nodes.get(id).callFrame;
      const key = `${f.functionName || '(anonymous)'}|${f.url}:${f.lineNumber + 1}`;
      sums.set(key, (sums.get(key) ?? 0) + ms);
    }
    return [...sums].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([frame, ms]) => ({ frame, ms }));
  };
  const categoryMs = {};
  for (let j = 0; j < profile.samples.length; j++) {
    const frames = [];
    for (let id = profile.samples[j]; id !== undefined; id = parents.get(id)) frames.push(nodes.get(id).callFrame);
    // Inclusive categories can overlap and must not be added together.
    const tags = {
      contracts: frames.some(f => /array-binding-contract|array-element-types/.test(f.url) || f.functionName === 'storedScalarKinds'),
      axisSelection: frames.some(f => f.functionName === 'materializeSelectedView'),
      concatCopies: frames.some(f => f.functionName === 'copyStoredArrayBlocks'),
      reshape: frames.some(f => /reshape/i.test(f.functionName)),
      gc: frames.some(f => f.functionName === '(garbage collector)'),
    };
    for (const [key, yes] of Object.entries(tags)) if (yes) categoryMs[key] = (categoryMs[key] ?? 0) + profile.timeDeltas[j] / 1000;
  }
  const sampledMs = [...self.values()].reduce((a, b) => a + b, 0);
  return { samples: profile.samples.length, sampledMs, categoryMs,
    categoryPercent: Object.fromEntries(Object.entries(categoryMs).map(([key, ms]) => [key, ms / sampledMs * 100])),
    categoryNote: 'inclusive categories; may overlap', self: aggregate(self), inclusive: aggregate(inclusive) };
}
if (!values.worker) {
  const samples = Number(values.samples), results = [];
  assert(samples > 0 && Number.isSafeInteger(samples));
  // Serial fresh processes, alternating mode order between samples.
  for (let trial = 0; trial < samples; trial++) for (const n of sizes) {
    for (const mode of trial % 2 ? [...modes].reverse() : modes) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${mode === 'baseline' ? 'compiled' : mode}`, `--size=${n}`, `--checkout=${mode === 'baseline' ? values.baseline : checkout}`, ...(values.fftjs ? [`--fftjs=${values.fftjs}`] : [])], { encoding: 'utf8', timeout: 60000 });
      assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
      results.push({ trial, ...JSON.parse(child.stdout), mode });
    }
    process.stderr.write(`sample ${trial + 1}/${samples}, N=${n}\n`);
  }
  const summary = sizes.flatMap(n => modes.map(mode => {
    const rows = results.filter(r => r.n === n && r.mode === mode);
    return { n, mode, firstSizeCallMedianMs: median(rows.map(r => r.firstSizeCallMs)), medianMs: median(rows.map(r => r.warmMs)),
      cpuMedianMs: median(rows.map(r => r.cpuMs)), minMs: Math.min(...rows.map(r => r.warmMs)), maxMs: Math.max(...rows.map(r => r.warmMs)) };
  }));
  const report = { date: new Date().toISOString(), cpu: cpus()[0].model, node: process.version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    fftjs: FFT ? { version: createRequire(import.meta.url)(values.fftjs.replace(/lib\/fft\.js$/, 'package.json')).version, path: values.fftjs } : undefined,
    checkout, baseline: values.baseline,
    sourceHash: createHash('sha256').update(source).digest('hex'),
    timing: 'serial fresh processes; each has >=300 ms warmup; per-call average of a batch targeting 150 ms; parsing, input creation and result validation excluded; coefficients, permutation and output materialization included',
    results, summary };
  if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} else {
  const mode = values.worker, n = Number(values.size);
  assert(modes.includes(mode)); assert(n > 0 && (n & (n - 1)) === 0);
  const generated = [], hooks = {};
  if (values.diagnostics) for (const kind of ['TensorKernel', 'IntegerLoop', 'FunctionBody', 'Block', 'Scalar'])
    hooks[`on${kind}Compiled`] = text => generated.push({ kind, source: text });
  const runtime = mode.startsWith('js-') || mode.startsWith('fftjs-') ? undefined : new Interpreter(() => {}, { compilation: mode === 'compiled', ...hooks });
  runtime?.execute(definitions);
  const rankCall = runtime?.variables.get('fftReal');
  const x = Array.from({ length: n }, (_, j) => Math.sin(2 * Math.PI * 17 * j / n) + 0.3 * Math.cos(2 * Math.PI * 41 * j / n));
  const input = createArraySnapshot(x, [n]);
  const plan = FFT ? new FFT(n) : undefined;
  const libraryInput = Float64Array.from(x), libraryOutput = new Float64Array(n * 2);
  const run = () => {
    if (runtime) return rankCall.call([input]).items.map(v => v.items);
    if (!mode.startsWith('fftjs-')) return jsFft(x, mode === 'js-inplace');
    const f = mode === 'fftjs-reuse' ? plan : new FFT(n);
    const out = mode === 'fftjs-reuse' ? libraryOutput : new Float64Array(n * 2);
    f.realTransform(out, libraryInput); f.completeSpectrum(out);
    return out;
  };
  // Independent oracle for small sizes; cross-check both JS versions too.
  for (const count of [2, 4, 8, 16, 32]) {
    const small = Array.from({ length: count }, (_, j) => Math.sin(j * 1.71) + Math.cos(j * .37));
    const expected = dft(small);
    check(jsFft(small, false), expected); check(jsFft(small, true), expected);
    if (runtime) check(rankCall.call([createArraySnapshot(small, [count])]).items.map(v => v.items), expected);
  }
  const expected = jsFft(x, true);
  const firstStart = performance.now(), first = run(), firstSizeCallMs = performance.now() - firstStart;
  check(first, expected);
  const warmupStart = performance.now();
  let warmups = 0;
  while (performance.now() - warmupStart < 300 || warmups < 3) { run(); warmups++; }
  check(run(), expected);
  if (values.diagnostics) {
    generated.length = 0;
    // A fresh runtime captures first-call generation separately from timings.
    const rt = new Interpreter(() => {}, { compilation: mode === 'compiled', ...hooks });
    const diagnostics = new RuntimeDiagnostics();
    diagnostics.run(() => { rt.execute(definitions); check(rt.variables.get('fftReal').call([input]).items.map(v => v.items), expected); });
    const before = generated.length, warmDiagnostics = new RuntimeDiagnostics();
    warmDiagnostics.run(() => check(rt.variables.get('fftReal').call([input]).items.map(v => v.items), expected));
    const warmGenerated = generated.slice(before);
    const report = { n, mode, diagnostics, warmDiagnostics, generated, warmGenerated };
    if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ n, mode, diagnostics, kernels: before, warmKernels: warmGenerated.length })); rt.dispose();
  } else if (values.profile) {
    assert(values.output, '--profile needs --output');
    assert(values.profile === 'cpu' || values.profile === 'allocation');
    const session = new Session(); session.connect();
    if (values.profile === 'cpu') {
      await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: 100 }); await session.post('Profiler.start');
    } else await session.post('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const start = performance.now(); let calls = 0;
    while (performance.now() - start < 2500) { run(); calls++; }
    const { profile } = await session.post(values.profile === 'cpu' ? 'Profiler.stop' : 'HeapProfiler.stopSampling');
    session.disconnect(); writeFileSync(values.output, JSON.stringify(profile));
    const bytes = node => node.selfSize + node.children.reduce((sum, child) => sum + bytes(child), 0);
    const summary = values.profile === 'cpu' ? profileSummary(profile) : { sampledAllocationBytes: bytes(profile.head), bytesPerCall: bytes(profile.head) / calls, note: 'V8 allocation sampling estimate, includes collected objects; not retained or peak heap' };
    writeFileSync(values.output + '.summary.json', JSON.stringify({ n, mode, calls, ...summary }, null, 2) + '\n');
    console.log(JSON.stringify({ n, mode, calls, ...summary }, null, 2));
  } else {
    const probeStart = performance.now(); run();
    const iterations = Math.max(runtime ? 3 : 100, Math.ceil(150 / Math.max(.001, performance.now() - probeStart)));
    const cpu = process.cpuUsage();
    const start = performance.now(); let result;
    for (let j = 0; j < iterations; j++) result = run();
    const warmMs = (performance.now() - start) / iterations;
    const used = process.cpuUsage(cpu), cpuMs = (used.user + used.system) / 1000 / iterations;
    check(result, expected);
    console.log(JSON.stringify({ n, mode, firstSizeCallMs, warmMs, cpuMs, iterations, warmups }));
  }
  runtime?.dispose();
}
