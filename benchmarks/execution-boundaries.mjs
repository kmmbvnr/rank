import assert from 'node:assert/strict';
import { Session } from 'node:inspector/promises';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Equal programs and inputs across revisions; independent exact answers.
const cases = {};
const calls = 100000;
const expected = BigInt(calls) * BigInt(calls - 1) + 21n * BigInt(calls);
for (const name of [false, true]) {
 cases[name ? 'return-name' : 'return-expression'] = [`fun X adjust Y
 A = X + Y
 B = A * 3
 ${name ? 'C = B - X\n return C' : 'return B - X'}
end
Total = 0
for I in 0 till ${calls}
 Total += I adjust 7
end
Total`, expected];
}
const count = 20000;
for (const form of ['inline', 'helper', 'binding']) {
 cases[form + '-index'] = [`use algo
fun bump N
 ${form === 'binding' ? 'Value = N + 1\n return Value' : 'return N + 1'}
end
Cache = new index
Cache 0 = 0
Total = 0
for I in 0 till ${count}
 K = I mod 128
 Cache K = ${form === 'inline' ? 'I + 1' : 'bump I'}
 Total += Cache K
end
Total`, BigInt(count) * BigInt(count + 1) / 2n];
}
const rounds = 2000;
for (const helper of [false, true]) {
 cases[helper ? 'rebound-helper' : 'rebound-inline'] = [`fun bump N
 Value = N + 1
 return Value
end
A = array shape 128 fill 0
Saved = A
Total = 0
for I in 0 till ${rounds}
 Delta = ${helper ? 'bump I' : 'I + 1'}
 A = A + Delta
 Total += A 0
end
Total + (Saved sum)`, BigInt(rounds) * BigInt(rounds + 1) * BigInt(rounds + 2) / 6n];
}
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
  scalarCalls: calls, indexIterations: count, reboundIterations: rounds, date: new Date().toISOString(), cpu: cpus()[0].model, arch: process.arch,
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
