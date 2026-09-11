import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(process.argv.slice(2).map(option => {
  const match = /^--(only|size|samples|checkout)=(.+)$/.exec(option);
  assert(match, `unknown option: ${option}`);
  return [match[1], match[2]];
}));
const size = Number(options.size ?? 200000);
const samples = Number(options.samples ?? 5);
assert(Number.isSafeInteger(size) && size >= 1 && size <= 200000);
assert(Number.isSafeInteger(samples) && samples >= 3 && samples <= 30);
const checkout = resolve(options.checkout ?? root);
const { Interpreter, parse } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
const sources = {
  restaurant: ['demos/cses/sortnsrch/005_restaurant.ra', 'busiest'],
  rooms: ['demos/cses/sortnsrch/022_rooms.ra', 'allocate_rooms'],
  playlist: ['demos/cses/sortnsrch/013_playlist.ra', 'longest_distinct'],
  books: ['demos/cses/sortnsrch/025_books.ra', 'minimum_reading_time'],
  'bounded-sum': ['demos/cses/sortnsrch/035_maxsum2.ra', 'maximum_bounded_sum'],
  sum: ['benchmarks/programs/sum.ra', undefined],
};
assert(!options.only || Object.hasOwn(sources, options.only), 'unknown case');
const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report = {
  metadata: { date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
    harnessRevision: revision(root), runtimeRevision: revision(checkout), size, samples,
    timing: 'first/warm: unchanged function call and output forcing, excluding input construction, parsing and print; sum evaluates its original A sum expression. Preparation is reported separately. Do not subtract these warm times from cold CLI times to estimate IO.' },
  results: [],
};
const array = (items, shape = [items.length]) => ({ kind: 'array', items, shape });
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
for (const [name, [path, functionName]] of Object.entries(sources)) {
  if (options.only && name !== options.only) continue;
  const preparationStart = performance.now();
  const source = readFileSync(resolve(root, path), 'utf8');
  // Bootstrap the unchanged program with a valid one-item input to load its
  // functions and imports. Real measured inputs are constructed below.
  const runtime = new Interpreter(() => {}, { input: { readToken: () => '1' } });
  try {
    runtime.execute(source);
    let args, expected, force = value => value;
    if (name === 'restaurant') {
      const events = runtime.execute('new queue');
      const visit = runtime.variables.get('visit');
      for (let i = 0; i < size; i++) visit.call([events, BigInt(3 * i + 1), BigInt(3 * i + 2)]);
      args = [events]; expected = 1n;
    } else if (name === 'rooms') {
      args = [array(Array.from({ length: size * 2 }, (_, i) => BigInt(i % 2 ? 2 * size + 1 : i / 2 + 1)), [size, 2])];
      expected = { count: BigInt(size), rooms: Array.from({ length: size }, (_, i) => BigInt(i + 1)) };
      force = value => ({ count: value.entries.get('count'), rooms: value.entries.get('rooms').items });
    } else if (name === 'playlist') {
      const period = Math.max(1, Math.floor(size / 2));
      args = [array(Array.from({ length: size }, (_, i) => BigInt(i % period + 1)))]; expected = BigInt(period);
    } else if (name === 'books') {
      const values = Array.from({ length: size }, (_, i) => i % 97 + 1);
      args = [array(values.map(BigInt))];
      expected = BigInt(Math.max(values.reduce((a, b) => a + b, 0), Math.min(size, 97) * 2));
    } else if (name === 'bounded-sum') {
      const bound = Math.min(1000, size);
      args = [array(Array(size).fill(1n)), BigInt(Math.min(10, size)), BigInt(bound)]; expected = BigInt(bound);
    } else {
      const values = Array.from({ length: size }, (_, i) => i % 101 - 50);
      runtime.variables.set('A', array(values.map(BigInt)));
      expected = BigInt(values.reduce((a, b) => a + b, 0));
    }
    const expression = name === 'sum' ? parse('A sum').statements[0].value : undefined;
    const fn = functionName ? runtime.variables.get(functionName) : undefined;
    const run = fn ? () => fn.call(args) : () => runtime.evaluate(expression);
    const preparationMs = performance.now() - preparationStart;
    const measure = () => {
      const start = performance.now();
      const result = force(run());
      const ms = performance.now() - start;
      assert.deepStrictEqual(result, expected, `${name}: wrong answer`);
      return ms;
    };
    const firstMs = measure();
    for (let i = 0; i < 2; i++) measure();
    const warmMs = Array.from({ length: samples }, measure);
    report.results.push({ name, path, sha256: createHash('sha256').update(source).digest('hex'),
      preparationMs, firstMs, warmMs, medianMs: median(warmMs), memory: process.memoryUsage() });
    console.error(`${name}: ${median(warmMs).toFixed(1)} ms compute; ${preparationMs.toFixed(1)} ms preparation`);
  } finally { runtime.dispose(); }
}
console.log(JSON.stringify(report, null, 2));
