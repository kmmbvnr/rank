// Compare unchanged numerical demos before admitting the FFT compiler changes.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, samples: { type: 'string', default: '5' },
  only: { type: 'string' }, output: { type: 'string' },
} });
assert(values.baseline, 'Pass an independently built --baseline checkout');
const samples = Number(values.samples);
assert(Number.isSafeInteger(samples) && samples >= 3);
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const demos = { euler: 'demos/euler/006_sumsquarediff.ra',
  matvec: 'demos/deepml/001_matmul.ra', row: 'demos/deepml/004_mean.ra',
  column: 'demos/deepml/004_mean.ra', matmul: 'demos/deepml/009_matmul.ra',
  gradient: 'demos/deepml/015_gd.ra', kmeans: 'demos/deepml/017_kmeans.ra' };
const cases = [...Object.keys(demos), 'integer-matrix', 'real-matrix', 'real-broadcast', 'fft'];
assert(!values.only || cases.includes(values.only));
const versions = { baseline: resolve(values.baseline), candidate: root };
const git = (path, ...args) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim();
const report = { date: new Date().toISOString(), node: process.version, cpu: cpus()[0].model,
  samples, versions: Object.fromEntries(Object.entries(versions).map(([version, path]) => [version, {
    path, commit: git(path, 'rev-parse', 'HEAD'), dirty: Boolean(git(path, 'status', '--porcelain')),
  }])),
  sources: Object.fromEntries(Object.entries({ ...demos, fft: 'demos/classic/fft.ra',
    stages: 'benchmarks/experiments/numeric-array-stages.mjs' }).map(([name, path]) => [name, { path,
    sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') }])),
  timing: 'Serial fresh processes; alternating order per pair. Demo workers use the largest existing numerical-demos.mjs scale, owned snapshot inputs, two warm calls and three measured calls; row is median of measured calls. Euler includes parsing. Array-stage fixtures time a complete parse/execute of 12 rounds. FFT uses the same current demo source in both builds, >=300 ms warmup and a batch targeting 150 ms, including output forcing. Every worker validates its output against the existing independent oracle. These are different timing contracts and should only be compared within a case.',
  results: [], summary: [],
};
for (const name of cases.filter(name => !values.only || name === values.only)) {
  for (let trial = 0; trial < samples; trial++) {
    for (const version of trial % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const checkout = versions[version], demo = name in demos;
      const args = name === 'fft' ? ['benchmarks/fft.mjs', '--worker=compiled', '--size=4096', `--checkout=${checkout}`]
        : demo ? ['benchmarks/numerical-demos.mjs', `--worker=${name}`, '--scale=2',
        '--samples=3', '--storage=snapshot', `--checkout=${checkout}`]
        : ['benchmarks/experiments/numeric-array-stages.mjs', name, 'compiled', '12'];
      const env = { ...process.env }; delete env.DIAGNOSTICS; delete env.RANK_BENCH_RUNTIME;
      if (!demo && name !== 'fft') env.RANK_BENCH_RUNTIME = resolve(checkout, 'packages/interpreter/out/index.js');
      const child = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 120000 });
      assert.ifError(child.error); assert.equal(child.status, 0, `${name}/${version}: ${child.stderr}`);
      const result = JSON.parse(child.stdout);
      report.results.push({ name, trial, version, ...result,
        measuredMs: demo ? median(result.warmMs) : name === 'fft' ? result.warmMs : result.ms });
    }
  }
  for (const version of Object.keys(versions)) {
    const rows = report.results.filter(r => r.name === name && r.version === version);
    report.summary.push({ name, version, medianMs: median(rows.map(r => r.measuredMs)),
      minMs: Math.min(...rows.map(r => r.measuredMs)), maxMs: Math.max(...rows.map(r => r.measuredMs)) });
  }
  if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  process.stderr.write(`${name}: ${report.summary.slice(-2).map(r => `${r.version} ${r.medianMs.toFixed(3)} ms`).join(', ')}\n`);
}
console.log(JSON.stringify(report.summary, null, 2));
