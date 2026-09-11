import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(import.meta.url);
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(baseline|samples|only|worker|checkout|scale|mode|order)=(.+)$/.exec(arg);
  assert(match, `Unknown argument: ${arg}`);
  return [match[1], match[2]];
}));
const sources = { euler: 'demos/euler/006_sumsquarediff.ra',
  matvec: 'demos/deepml/001_matmul.ra',
  kmeans: 'demos/deepml/017_kmeans.ra',
  row: 'demos/deepml/004_mean.ra', column: 'demos/deepml/004_mean.ra',
  matmul: 'demos/deepml/009_matmul.ra', gradient: 'demos/deepml/015_gd.ra' };
const sizes = { euler: [100, 20000, 200000], matvec: [8, 128, 512], row: [8, 128, 512],
  kmeans: [16, 256, 2048],
  column: [8, 128, 512], matmul: [4, 24, 64], gradient: [16, 256, 2048] };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const samples = Number(options.samples ?? 5);
assert(Number.isSafeInteger(samples) && samples >= 3);
assert(options.order === undefined || ['candidate-first', 'baseline-first'].includes(options.order));
if (options.worker) {
  const name = options.worker;
  assert(name in sources);
  const scale = Number(options.scale);
  assert(Number.isInteger(scale) && scale >= 0 && scale < 3);
  const size = sizes[name][scale];
  const { Interpreter } = await import(pathToFileURL(resolve(options.checkout ?? root, 'packages/interpreter/out/index.js')));
  const source = readFileSync(resolve(root, sources[name]), 'utf8');
  const array = (items, shape) => ({ kind: 'array', items, shape });
  const matrix = (rows, cols, fn) => array(Array.from({ length: rows * cols }, (_, i) => fn(Math.floor(i / cols), i % cols)), [rows, cols]);
  const runtime = new Interpreter(() => {}, { args: name === 'euler' ? ['--limit', String(size)] : [] });
  let run, expected;
  if (name === 'euler') {
    const n = BigInt(size);
    expected = (n * (n + 1n) / 2n) ** 2n - n * (n + 1n) * (2n * n + 1n) / 6n;
    // Full unchanged top-level source, including parsing on each execution.
    run = () => runtime.execute(source);
  } else {
    runtime.execute(source);
    if (name === 'row' || name === 'column') {
      const a = matrix(size, size, (r, c) => r % 7 + c % 11 + 0.25);
      const axisMean = modulus => Array.from({ length: size }, (_, i) => i % modulus).reduce((a, b) => a + b, 0) / size;
      expected = Array.from({ length: size }, (_, i) => name === 'row' ? i % 7 + axisMean(11) + 0.25 : i % 11 + axisMean(7) + 0.25);
      run = () => runtime.variables.get('matrix_mean').call([a, name]);
    } else if (name === 'kmeans') {
      const points = matrix(size, 2, (r, c) => (r % 2) * 10 + (Math.floor(r / 2) % 2) * 2 + c);
      const centroids = matrix(2, 2, (r, c) => r * 10 + c);
      expected = [1, 2, 11, 12];
      run = () => runtime.variables.get('k_means').call([points, 2n, centroids, 5n]);
    } else if (name === 'matvec') {
      const a = matrix(size, size, (r, c) => (r + c) % 7 / 8);
      const b = array(Array.from({ length: size }, (_, c) => c % 5 / 4), [size]);
      expected = Array.from({ length: size }, (_, r) => {
        let sum = 0;
        for (let c = 0; c < size; c++) sum += a.items[r * size + c] * b.items[c];
        return sum;
      });
      run = () => runtime.variables.get('matrix_dot_vector').call([a, b]);
    } else if (name === 'matmul') {
      const a = matrix(size, size, (r, c) => (r + c) % 7 / 8);
      const b = matrix(size, size, (r, c) => (r * 3 + c) % 5 / 4);
      expected = [];
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        let sum = 0;
        for (let k = 0; k < size; k++) sum += a.items[r * size + k] * b.items[k * size + c];
        expected.push(sum);
      }
      run = () => runtime.variables.get('matrixmul').call([a, b]);
    } else {
      const features = 8, steps = 20, rate = 0.5;
      const x = matrix(size, features, (r, c) => Number(r % features === c));
      const y = array(Array.from({ length: size }, (_, r) => r % features + 1), [size]);
      expected = Array.from({ length: features }, (_, c) => Math.round((c + 1) * (1 - (1 - rate / features) ** steps) * 10000) / 10000);
      run = () => runtime.variables.get('linear_regression').call([x, y, rate, BigInt(steps)]);
    }
  }
  const check = value => {
    if (name === 'euler') assert.equal(value, expected);
    else {
      const items = value.items;
      assert.equal(items.length, expected.length);
      for (let i = 0; i < items.length; i++) assert(Math.abs(Number(items[i]) - expected[i]) < 1e-9, `${name}[${i}]`);
      if (name === 'matmul') assert.deepEqual(value.shape, [size, size]);
    }
  };
  // Force the result within the timed region: lazy output is part of computation.
  const measure = () => {
    const start = performance.now();
    const value = run();
    if (value && typeof value === 'object' && 'items' in value) void value.items;
    const ms = performance.now() - start;
    check(value);
    return ms;
  };
  const firstMs = measure();
  if (options.mode !== 'cold') for (let i = 0; i < 2; i++) measure();
  const warmMs = options.mode === 'cold' ? [] : Array.from({ length: samples }, measure);
  runtime.dispose();
  console.log(JSON.stringify({ size, firstMs, warmMs, memory: process.memoryUsage(), maxRSSKiB: process.resourceUsage().maxRSS }));
} else {
  const checkouts = { candidate: root, ...(options.baseline ? { baseline: resolve(options.baseline) } : {}) };
  const report = { metadata: { date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
    samples, timing: 'cold: fresh child, import, input setup, oracle, one execution/check; warm: function call and output forcing (Euler also parses); memory: process peak and final snapshot, not allocation counts',
    sources: Object.fromEntries(Object.entries(sources).map(([name, path]) => [name, { path, sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') }])) }, versions: {}, results: [] };
  for (const [name, checkout] of Object.entries(checkouts)) report.versions[name] = { checkout,
    revision: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) };
  if (options.only) assert(options.only in sources);
  for (const name of Object.keys(sources).filter(name => !options.only || name === options.only)) {
    for (let scale = 0; scale < 3; scale++) {
      const entries = Object.entries(checkouts);
      if (Boolean(scale % 2) !== (options.order === 'baseline-first')) entries.reverse();
      for (const [version, checkout] of entries) {
        const start = performance.now();
        const child = spawnSync(process.execPath, [script, `--worker=${name}`, `--scale=${scale}`, `--checkout=${checkout}`, `--samples=${samples}`], { encoding: 'utf8', timeout: 120000 });
        assert.ifError(child.error);
        assert.equal(child.status, 0, child.stderr);
        const result = { name, scale, version, warmProcessMs: performance.now() - start, ...JSON.parse(child.stdout), coldProcessMs: [] };
        report.results.push(result);
        console.error(`${version} ${name}/${result.size}: ${median(result.warmMs).toFixed(1)} ms warm; ${(result.maxRSSKiB / 1024).toFixed(1)} MiB peak`);
      }
      for (let sample = 0; sample < samples; sample++) {
        const order = sample % 2 ? [...entries].reverse() : entries;
        for (const [version, checkout] of order) {
          const start = performance.now();
          const child = spawnSync(process.execPath, [script, `--worker=${name}`, `--scale=${scale}`, `--checkout=${checkout}`, '--mode=cold'], { encoding: 'utf8', timeout: 120000 });
          assert.ifError(child.error);
          assert.equal(child.status, 0, child.stderr);
          report.results.find(result => result.name === name && result.scale === scale && result.version === version).coldProcessMs.push(performance.now() - start);
        }
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
}
