// Completed numeric producers and copies, with full output forcing.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, checkout: { type: 'string' }, worker: { type: 'string' },
  samples: { type: 'string', default: '5' }, output: { type: 'string' },
  only: { type: 'string' }, audit: { type: 'boolean', default: false },
} });
const paths = {
  kmeans: 'demos/deepml/017_kmeans.ra',
  convolution: 'demos/deepml/041_conv2d.ra',
  softmax: 'demos/deepml/023_softmax.ra',
  logsoftmax: 'demos/deepml/039_logsoftmax.ra',
  gradient: 'demos/deepml/015_gd.ra',
};
const sources = Object.fromEntries(Object.entries(paths).map(([name, path]) =>
  [name, readFileSync(resolve(root, path), 'utf8')]));
sources.distance = `fun A distance B\n D = A - B\n return D * D sum\nend`;
sources.moving = `fun X moving\n W' = X window 32\n return (W * 0.5 + 1) mean rank 1\nend`;
sources.rowStats = `fun X rowStats\n return ((X - 1) * (X + 1)) sum rank 1\nend`;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
if (!values.worker) {
  assert(values.baseline, 'Pass an independently built --baseline');
  assert(!values.only || values.only in sources);
  const names = Object.keys(sources).filter(name => !values.only || name === values.only);
  const samples = Number(values.samples); assert(Number.isSafeInteger(samples) && samples >= 3);
  const versions = { baseline: resolve(values.baseline), candidate: root }, results = [];
  for (const name of names) for (let trial = 0; trial < samples; trial++) {
    for (const version of trial % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`, `--checkout=${versions[version]}`], { encoding: 'utf8', timeout: 60000 });
      assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
      results.push({ trial, version, ...JSON.parse(child.stdout) });
    }
    process.stderr.write(`${name} ${trial + 1}/${samples}\n`);
  }
  const summary = names.flatMap(name => Object.keys(versions).map(version => {
    const rows = results.filter(r => r.name === name && r.version === version);
    return { name, version, medianMs: median(rows.map(r => r.ms)), cpuMedianMs: median(rows.map(r => r.cpuMs)),
      minMs: Math.min(...rows.map(r => r.ms)), maxMs: Math.max(...rows.map(r => r.ms)) };
  }));
  const report = { date: new Date().toISOString(), node: process.version, cpu: cpus()[0].model, versions,
    commits: Object.fromEntries(Object.entries(versions).map(([name, path]) => [name,
      execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()])),
    timing: 'serial fresh processes, alternating order; >=1000 ms warmup, three target 300 ms batches; function entry/return, output allocation and host-array forcing included; input and independent oracle prepared outside timing',
    sources, results, summary };
  if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} else {
  const name = values.worker; assert(name in sources);
  const checkout = values.checkout ?? root;
  const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
  const { demandValue } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/plan.js')));
  const { typedArray } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/array-storage.js')));
  const runtime = new Interpreter(() => {});
  runtime.execute('use numbers\nuse sequences\nuse stats\n' + sources[name]);
  const vector = xs => typedArray(Float64Array.from(xs), [xs.length], undefined, 'real');
  const matrix = (rows, cols, f) => typedArray(Float64Array.from({ length: rows * cols },
    (_, i) => f(Math.floor(i / cols), i % cols)), [rows, cols], undefined, 'real');
  let fn, args, expected;
  if (name === 'softmax' || name === 'logsoftmax') {
    const xs = Array.from({ length: 4096 }, (_, i) => 2 * Math.sin(i * .37));
    const top = Math.max(...xs), exps = xs.map(x => Math.exp(x - top)), total = exps.reduce((a, b) => a + b, 0);
    expected = name === 'softmax' ? exps.map(x => x / total)
      : xs.map(x => Math.round((x - top - Math.log(total)) * 10000) / 10000);
    fn = name === 'softmax' ? 'softmax' : 'log_softmax'; args = [vector(xs)];
  } else if (name === 'convolution') {
    const n = 24, k = 3, a = (r, c) => ((r * 7 + c * 3) % 13) / 8;
    const weight = (r, c) => (r - c + 1) / 4;
    args = [matrix(n, n, a), matrix(k, k, weight), 0n, 1n]; fn = 'simple_conv2d'; expected = [];
    for (let r = 0; r <= n - k; r++) for (let c = 0; c <= n - k; c++) {
      let sum = 0;
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) sum += a(r + i, c + j) * weight(i, j);
      expected.push(sum);
    }
  } else if (name === 'moving') {
    const xs = Array.from({ length: 4096 }, (_, i) => Math.sin(i * .19));
    args = [vector(xs)]; fn = 'moving';
    expected = Array.from({ length: xs.length - 31 }, (_, start) => {
      let sum = 0; for (let i = 0; i < 32; i++) sum += xs[start + i] * .5 + 1; return sum / 32;
    });
  } else if (name === 'rowStats') {
    const rows = 128, cols = 32, x = (r, c) => Math.sin(r * .3 + c * .17);
    args = [matrix(rows, cols, x)]; fn = 'rowStats';
    expected = Array.from({ length: rows }, (_, r) => {
      let sum = 0; for (let c = 0; c < cols; c++) sum += (x(r, c) - 1) * (x(r, c) + 1); return sum;
    });
  } else if (name === 'kmeans') {
    args = [matrix(256, 2, (r, c) => (r % 2) * 10 + (Math.floor(r / 2) % 2) * 2 + c),
      2n, matrix(2, 2, (r, c) => r * 10 + c), 5n]; fn = 'k_means'; expected = [1, 2, 11, 12];
  } else if (name === 'gradient') {
    const n = 256, features = 8, steps = 8, rate = .5;
    args = [matrix(n, features, (r, c) => Number(r % features === c)),
      vector(Array.from({ length: n }, (_, i) => i % features + 1)), rate, BigInt(steps)]; fn = 'linear_regression';
    expected = Array.from({ length: features }, (_, c) => Math.round((c + 1) * (1 - (1 - rate / features) ** steps) * 10000) / 10000);
  } else {
    const a = Array.from({ length: 4096 }, (_, i) => Math.sin(i * .37)), b = a.map((x, i) => Math.cos(i * .19));
    expected = [a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0)]; args = [vector(a), vector(b)]; fn = 'distance';
  }
  const call = runtime.variables.get(fn);
  const run = () => { const out = demandValue(call.call(args)); return typeof out === 'number' || typeof out === 'bigint' ? [out] : out.items; };
  const check = actual => { assert.equal(actual.length, expected.length); for (let i = 0; i < expected.length; i++)
    assert(Math.abs(Number(actual[i]) - expected[i]) <= 1e-9 * Math.max(1, Math.abs(expected[i])), `${name}[${i}]: ${actual[i]} != ${expected[i]}`); };
  if (values.audit) {
    check(run());
    const diagnostics = new RuntimeDiagnostics(); diagnostics.run(() => check(run()));
    console.log(JSON.stringify({ name, diagnostics })); runtime.dispose(); process.exit(0);
  }
  check(run()); let count = 0, start = performance.now();
  while (performance.now() - start < 1000 || count < 3) { run(); count++; }
  const probe = performance.now(); run();
  const iterations = Math.max(3, Math.ceil(300 / Math.max(.001, performance.now() - probe)));
  const batches = [];
  for (let batch = 0; batch < 3; batch++) {
    const cpu = process.cpuUsage(); start = performance.now(); let result;
    for (let i = 0; i < iterations; i++) result = run();
    const ms = (performance.now() - start) / iterations, used = process.cpuUsage(cpu); check(result);
    batches.push({ ms, cpuMs: (used.user + used.system) / 1000 / iterations });
  }
  const ms = median(batches.map(b => b.ms)), cpuMs = median(batches.map(b => b.cpuMs));
  const diagnostics = new RuntimeDiagnostics(); diagnostics.run(run);
  console.log(JSON.stringify({ name, iterations, ms, cpuMs, batches,
    sourceHash: createHash('sha256').update(sources[name]).digest('hex'), diagnostics }));
  runtime.dispose();
}
