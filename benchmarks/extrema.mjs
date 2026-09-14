import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

// The same source and input run against both runtimes, even if demos changed.
const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(baseline|size|samples)=(.+)$/.exec(arg);
  if (!match) throw Error(`Unknown option: ${arg}`);
  return [match[1], match[2]];
}));
const size = Number(options.size ?? 1_000_000);
const samples = Number(options.samples ?? 5);
assert(Number.isSafeInteger(size) && size > 0);
assert(Number.isSafeInteger(samples) && samples >= 3);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const bodies = {
  infixmax: 'Best = Best max I', aliasmax: 'Best = Best I Op',
  infixmin: 'Best = Best min (-I)', aliasmin: 'Best = Best (-I) Op',
  arithmetic: 'Best += I', conditional: 'if I greater Best\n Best = I\n end',
};
const source = `use numbers\n${Object.entries(bodies).map(([name, body]) => `
fun ${name} N
 Op = ${name.endsWith('min') ? 'min' : 'max'}
 Best = 0
 for I in 0 until N
  ${body}
 end
 return Best
end`).join('\n')}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const checkouts = { candidate: root, ...(options.baseline ? { baseline: resolve(options.baseline) } : {}) };
const report = { metadata: { date: new Date().toISOString(), node: process.version,
  cpu: cpus()[0]?.model, size, samples, source, sourceHash: hash(source),
  policy: 'median ratios: infix/alias <= 1.5; candidate/baseline <= 1.25; alternating order',
}, versions: {}, comparisons: {}, failures: [] };
const runtimes = {};
for (const [name, checkout] of Object.entries(checkouts)) {
  const { Interpreter } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
  const runtime = new Interpreter();
  runtime.execute(source);
  runtimes[name] = runtime;
  report.versions[name] = {
    checkout, revision: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['-C', checkout, 'status', '--porcelain'], { encoding: 'utf8' }).trim()),
    scalar: Object.fromEntries(Object.keys(bodies).map(key => [key, []])), playlist: [],
  };
  for (const key of Object.keys(bodies)) for (let i = 0; i < 3; i++) runtime.variables.get(key).call([10000n]);
}
const alternating = (values, iteration) => iteration % 2 ? [...values].reverse() : values;
for (let iteration = 0; iteration < samples; iteration++) {
  for (const key of alternating(Object.keys(bodies), iteration)) {
    for (const name of alternating(Object.keys(runtimes), iteration)) {
      const start = performance.now();
      const result = runtimes[name].variables.get(key).call([BigInt(size)]);
      const ms = performance.now() - start;
      const expected = key === 'arithmetic' ? BigInt(size) * BigInt(size - 1) / 2n
        : BigInt(size - 1) * (key.endsWith('min') ? -1n : 1n);
      assert.equal(result, expected);
      report.versions[name].scalar[key].push(ms);
    }
  }
}
for (const runtime of Object.values(runtimes)) runtime.dispose();
const demo = resolve(root, 'demos/cses/sortnsrch/013_playlist.ra');
report.metadata.playlistSourceHash = hash(readFileSync(demo));
report.metadata.playlistSize = 200000;
report.metadata.playlistTiming = 'cold CLI including parse and I/O';
const input = `200000\n${Array.from({ length: 200000 }, (_, i) => i % 100000 + 1).join(' ')}\n`;
for (let iteration = 0; iteration < samples; iteration++) {
  for (const name of alternating(Object.keys(checkouts), iteration)) {
    const start = performance.now();
    const child = spawnSync(process.execPath, [resolve(checkouts[name], 'packages/cli/bin/cli.js'), demo],
      { input, encoding: 'utf8', timeout: 30000 });
    const ms = performance.now() - start;
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), '100000');
    report.versions[name].playlist.push(ms);
  }
}
const ratio = (label, numerator, denominator, limit) => {
  const value = median(numerator) / median(denominator);
  report.comparisons[label] = value;
  if (value > limit) report.failures.push(`${label}: ${value.toFixed(2)} > ${limit}`);
};
const candidate = report.versions.candidate;
for (const operation of ['min', 'max']) ratio(`infix/alias ${operation}`,
  candidate.scalar[`infix${operation}`], candidate.scalar[`alias${operation}`], 1.5);
if (report.versions.baseline) {
  for (const key of Object.keys(bodies)) ratio(`candidate/baseline ${key}`,
    candidate.scalar[key], report.versions.baseline.scalar[key], 1.25);
  ratio('candidate/baseline playlist', candidate.playlist, report.versions.baseline.playlist, 1.25);
}
console.log(JSON.stringify(report, null, 2));
if (report.failures.length) process.exitCode = 1;
