import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { gridCase } from './dense-write-cases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(process.argv.slice(2).map(option => {
  const match = /^--(size|timeout-ms|checkout|only)=(.+)$/.exec(option);
  if (!match) throw new Error(`Unknown option: ${option}`);
  return [match[1], match[2]];
}));
const size = Number(options.size ?? 200_000);
const timeout = Number(options['timeout-ms'] ?? 30_000);
for (const [name, value] of [['size', size], ['timeout-ms', timeout]]) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
}
if (size > 200_000) throw new Error('size must not exceed 200000');
const checkout = resolve(options.checkout ?? root);
const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const period = Math.max(1, Math.floor(size / 2));
const bound = Math.min(1000, size);
const reading = Array.from({ length: size }, (_, i) => i % 97 + 1);
const summands = Array.from({ length: size }, (_, i) => i % 101 - 50);
const lines = values => values.join(' ');
// Expected answers follow from the constructed inputs, not from Rank execution.
const cases = [
  gridCase(Math.min(1000, size)),
  { name: 'restaurant', path: 'demos/cses/sortnsrch/005_restaurant.ra',
    input: `${size}\n${Array.from({ length: size }, (_, i) => `${3 * i + 1} ${3 * i + 2}`).join('\n')}\n`, expected: '1' },
  { name: 'rooms', path: 'demos/cses/sortnsrch/022_rooms.ra',
    input: `${size}\n${Array.from({ length: size }, (_, i) => `${i + 1} ${2 * size + 1}`).join('\n')}\n`,
    expected: `${size}\n${lines(Array.from({ length: size }, (_, i) => i + 1))}` },
  { name: 'playlist', path: 'demos/cses/sortnsrch/013_playlist.ra',
    input: `${size}\n${lines(Array.from({ length: size }, (_, i) => i % period + 1))}\n`, expected: String(period) },
  { name: 'books', path: 'demos/cses/sortnsrch/025_books.ra',
    input: `${size}\n${lines(reading)}\n`, expected: String(Math.max(reading.reduce((a, b) => a + b, 0), Math.min(size, 97) * 2)) },
  { name: 'bounded-sum', path: 'demos/cses/sortnsrch/035_maxsum2.ra',
    input: `${size} ${Math.min(10, size)} ${bound}\n${'1 '.repeat(size)}\n`, expected: String(bound) },
  { name: 'sum', path: 'benchmarks/programs/sum.ra',
    input: `${size}\n${lines(summands)}\n`, expected: String(summands.reduce((a, b) => a + b, 0)) },
];
if (options.only && !cases.some(test => test.name === options.only)) throw new Error(`Unknown case: ${options.only}`);
const report = { metadata: { date: new Date().toISOString(), node: process.version,
  cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  harnessRevision: revision(root), runtimeRevision: revision(checkout), checkout,
  size, timeoutMs: timeout, timing: 'one cold CLI process per case, including startup, parsing, input and output' }, results: [] };
for (const test of cases.filter(test => !options.only || test.name === options.only)) {
  const start = performance.now();
  const child = spawnSync(process.execPath, [resolve(checkout, 'packages/cli/bin/cli.js'), resolve(root, test.path)], {
    input: test.input, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024,
  });
  const ms = performance.now() - start;
  let failure;
  if (child.error) failure = child.error.code === 'ETIMEDOUT' ? 'time limit exceeded' : child.error.message;
  else if (child.status !== 0) failure = `exit ${child.status}: ${child.stderr.trim().slice(0, 1000)}`;
  else {
    try { assert.equal(child.stdout.trim(), test.expected); }
    catch { failure = `wrong answer (${child.stdout.length} output characters)`; }
    if (!failure && ms > timeout) failure = 'time limit exceeded';
  }
  report.results.push({ name: test.name, ms, passed: !failure, ...(failure ? { failure } : {}) });
  console.error(`${test.name}: ${ms.toFixed(1)} ms ${failure ?? 'PASS'}`);
}
console.log(JSON.stringify(report, null, 2));
if (report.results.some(test => !test.passed)) process.exitCode = 1;
