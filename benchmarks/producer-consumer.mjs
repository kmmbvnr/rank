import assert from 'node:assert/strict';
import { Session } from 'node:inspector/promises';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Algorithms and input sizes are identical across revisions.
const cases = {};
const count = 200000;
const total = BigInt(count) * BigInt(count - 1) / 2n;
for (const bound of [false, true]) {
 cases[bound ? 'materialized' : 'polynomial'] = [`use sequences
T = 0 till ${count} array
V${bound ? '' : "'"} = T * 1000000000001 + 1
K${bound ? '' : "'"} = (T * T + 3) mod 97
(V sum by K size 97) sum`, total * 1000000000001n + BigInt(count)];
}
cases.stored = [`use sequences\nT = 0 till ${count} array\nV = array shape ${count} fill 1\nK = T mod 97\n(V sum by K size 97) sum`, BigInt(count)];
cases.scan = [`use sequences
T = 0 till ${count} array
V' = T * 1000000000001 + 1
K' = T mod 97
(V scan + by K) last`, 0n];
for (let i = (count - 1) % 97; i < count; i += 97) cases.scan[1] += BigInt(i) * 1000000000001n + 1n;
const m = Number(process.env.EULER_M ?? 100000);
const n = 1000000000000n;
const seen = new Uint32Array(m), tail = new Uint32Array(m);
const period = 6 * m, whole = n / BigInt(period), rest = Number(n % BigInt(period));
// Independent recurrence oracle; do not use the producer's polynomial.
let weight = 0n, prefix = 0;
for (let i = 0; i < period; i++) {
 seen[prefix]++;
 if (i <= rest) tail[prefix]++;
 const k = BigInt(i + 1), a = i === 0 ? 1n : weight % k;
 weight += k * a;
 prefix = (prefix + Number(a)) % m;
}
let expected = 0n;
for (let i = 0; i < m; i++) {
 const c = whole * BigInt(seen[i]) + BigInt(tail[i]);
 expected += c * (c - 1n) / 2n;
}
cases.euler326 = [`use sequences
M = ${m}
N = ${n}
Whole = N // (6 * M)
Rest = N mod (6 * M)
T = 0 till M array
B = array -1 3 6 7 13 14
C = array 0 1 2 2 5 5
Ones = array shape M fill 1
Seen = array shape M fill 0
Tail = array shape M fill 0
for R in 0 till 6
 Slope = B R
 Offset = C R
 Keys' = (9 * T * T + Slope * T + Offset) mod M
 Seen += Ones sum by Keys size M
 Length = (Rest - R) // 6 + 1
 if Length greater 0
  Part' = Keys take Length
  Values' = Ones take Length
  Tail += Values sum by Part size M
 end
end
Counts = Whole * Seen + Tail
((Counts * (Counts - 1)) // 2) sum`, expected];
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv[2] === '--worker') {
 const [, , , checkout, name, engine, enabled] = process.argv;
 const { Interpreter, RuntimeDiagnostics, parse } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
 const [source, expected] = cases[name];
 const runtime = new Interpreter(() => {}, { compilation: engine === 'compiled', scalarEntryCompilation: false });
 const stats = enabled === 'on' ? new RuntimeDiagnostics() : undefined;
 const program = parse(source);
 global.gc();
 const before = process.memoryUsage();
 const profiler = enabled === 'on' ? new Session() : undefined;
 if (profiler) {
  profiler.connect();
  await profiler.post('HeapProfiler.startSampling', { samplingInterval: 32768,
   includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
 }
 const start = performance.now();
 const result = stats ? stats.run(() => runtime.executeProgram(program)) : runtime.executeProgram(program);
 const milliseconds = performance.now() - start;
 assert.equal(result, expected);
 let sampledAllocatedBytes;
 if (profiler) {
  const { profile } = await profiler.post('HeapProfiler.stopSampling');
  const bytes = node => node.selfSize + node.children.reduce((n, child) => n + bytes(child), 0);
  sampledAllocatedBytes = bytes(profile.head);
  profiler.disconnect();
 }
 global.gc();
 // runtime remains reachable: these are retained process totals, not allocation counts.
 const retained = process.memoryUsage();
 const variables = runtime.variables.size;
 runtime.dispose();
 console.log(JSON.stringify({ sampledAllocatedBytes, milliseconds, result: String(result), variables,
  peakRssBytes: process.resourceUsage().maxRSS * 1024,
  retainedHeapBytes: retained.heapUsed, retainedArrayBufferBytes: retained.arrayBuffers,
  retainedHeapDelta: retained.heapUsed - before.heapUsed,
  retainedArrayBufferDelta: retained.arrayBuffers - before.arrayBuffers,
  diagnostics: stats }));
} else {
 const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(baseline|samples|cases)=(.+)$/.exec(arg);
  if (!match) throw Error(`Unknown option: ${arg}`);
  return [match[1], match[2]];
 }));
 const samples = Number(options.samples ?? 5);
 assert(Number.isSafeInteger(samples) && samples >= 3);
 const selected = options.cases ? options.cases.split(',') : Object.keys(cases);
 for (const name of selected) assert(name in cases, name);
 const versions = [
  ...(options.baseline ? [{ name: 'baseline-off', root: resolve(options.baseline), enabled: 'off' },
   { name: 'baseline-on', root: resolve(options.baseline), enabled: 'on' }] : []),
  { name: 'candidate-off', root, enabled: 'off' }, { name: 'candidate-on', root, enabled: 'on' },
 ];
 const sourceHash = checkout => {
  const folder = resolve(checkout, 'packages/interpreter/src');
  const hash = createHash('sha256');
  for (const path of readdirSync(folder, { recursive: true }).filter(p => p.endsWith('.ts')).sort()) {
   hash.update(path).update('\0').update(readFileSync(resolve(folder, path)));
  }
  return hash.digest('hex');
 };
 const report = { sourceHashes: Object.fromEntries(versions.map(v => [v.name, sourceHash(v.root)])),
  allocationMethod: 'V8 sampled JS heap allocations, including collected objects, 32768-byte interval; diagnostic-on runs only; excludes external ArrayBuffer payload',
  eulerModulus: m, independentInputCount: count, date: new Date().toISOString(), cpu: cpus()[0].model, arch: process.arch,
  node: process.version, revision: process.env.REVISION ?? execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  samples, scope: 'fresh-process executeProgram; parsing excluded; forced GC with live runtime',
  cases, observations: [], ratios: {} };
 for (let sample = 0; sample < samples; sample++) {
  for (const name of selected) for (const engine of ['reference', 'compiled']) {
   const ordered = sample % 2 ? [...versions].reverse() : versions;
   for (const version of ordered) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', version.root, name, engine, version.enabled],
     { encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    report.observations.push({ sample, name, engine, version: version.name, ...JSON.parse(child.stdout) });
   }
  }
  console.error(`Sample ${sample + 1}/${samples} complete`);
 }
 const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
 for (const name of selected) for (const engine of ['reference', 'compiled']) {
  const medians = Object.fromEntries(versions.map(version => [version.name, median(report.observations
   .filter(x => x.name === name && x.engine === engine && x.version === version.name).map(x => x.milliseconds))]));
  report.ratios[`${name}/${engine}`] = { medians,
   disabled: medians['candidate-off'] / medians['baseline-off'],
   enabled: medians['candidate-on'] / medians['candidate-off'] };
 }
 console.log(JSON.stringify(report, (_, value) => typeof value === 'bigint' ? String(value) : value, 2));
}
