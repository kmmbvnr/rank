import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { denseSource, denseCases, dpCases } from './dense-write-cases.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
 const match = /^--(baseline|samples)=(.+)$/.exec(arg);
 if (!match) throw Error(`Unknown option: ${arg}`);
 return [match[1], match[2]];
}));
const samples = Number(options.samples ?? 5);
assert(Number.isSafeInteger(samples) && samples >= 3);
const checkouts = { candidate: root, ...(options.baseline ? { baseline: resolve(options.baseline) } : {}) };
const report = { metadata: { date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
 samples, source: denseSource, timing: 'parse-once microbenchmarks; cold CLI demos; alternating order',
 policy: 'candidate/baseline median <= 1.25 for each case' }, versions: {}, ratios: {}, failures: [] };
const runtimes = {};
for (const [name, checkout] of Object.entries(checkouts)) {
 const { Interpreter } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
 const runtime = new Interpreter();
 runtime.execute(denseSource);
 runtimes[name] = runtime;
 report.versions[name] = { checkout,
  revision: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim()), results: {} };
 for (const [key, , , warmup] of denseCases) for (let i = 0; i < 3; i++) runtime.variables.get(key).call(warmup);
}
const demos = dpCases();
const hash = value => createHash('sha256').update(value).digest('hex');
report.metadata.demos = demos.map(test => ({ name: test.name, path: test.path,
 sourceHash: hash(readFileSync(resolve(root, test.path))), inputHash: hash(test.input), expected: test.expected }));
for (let iteration = 0; iteration < samples; iteration++) {
 const names = Object.keys(checkouts);
 if (iteration % 2) names.reverse();
 for (const [key, args, expected] of denseCases) for (const name of names) {
  const start = performance.now();
  assert.equal(runtimes[name].variables.get(key).call(args), expected);
  (report.versions[name].results[key] ??= []).push(performance.now() - start);
 }
 for (const test of demos) for (const name of names) {
  const start = performance.now();
  const child = spawnSync(process.execPath, [resolve(checkouts[name], 'packages/cli/bin/cli.js'), resolve(root, test.path)],
   { input: test.input, encoding: 'utf8', timeout: 30000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), test.expected);
  (report.versions[name].results[test.name] ??= []).push(performance.now() - start);
 }
 console.error(`Sample ${iteration + 1}/${samples} complete`);
}
for (const runtime of Object.values(runtimes)) runtime.dispose();
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const version of Object.values(report.versions)) version.medians = Object.fromEntries(
 Object.entries(version.results).map(([key, values]) => [key, median(values)]));
if (report.versions.baseline) for (const [key, value] of Object.entries(report.versions.candidate.medians)) {
 const ratio = value / report.versions.baseline.medians[key];
 report.ratios[key] = ratio;
 if (ratio > 1.25) report.failures.push(`${key}: ${ratio.toFixed(2)} > 1.25`);
}
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
