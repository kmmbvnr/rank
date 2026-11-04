import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Each observation gets a fresh process, including its own parser and JIT.
const cases = {
 scalar: ['Total = 0\nfor I in 0 till 12000\n Total += I\nend\nTotal', 71994000n],
 dense: ['A = array shape 12000 fill 0\nfor I in 0 till 12000\n A I = I\nend\nA sum', 71994000n],
 sparse: ['A = array shape 20000 fill 0\nfor I in 0 till 120\n A (I * 127) += 1\nend\nA sum', 120n],
 grouped: ['V = array shape 12000 fill 1\nK = array shape 12000 fill 0\n(V sum by K) sum', 12000n],
 container: ['use algo\nF = 128 fenwick\nfor I in 0 till 12000\n F (I mod 128) += 1\nend\nF sum 127', 12000n],
 replay: ['A = array shape 3 fill 0\nTotal = 0\nfor I in 0 till 3\n A I = I\n Total += 4503599627370495\nend\nTotal', 13510798882111485n],
};
// Container-contract controls use identical algorithms in both checkouts.
const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
const compositionTotal = Array.from({ length: 12000 }, (_, i) =>
 BigInt(Math.floor(i / 128) + 1 + gcd(i, 6))).reduce((a, b) => a + b, 0n);
for (const wide of [false, true]) {
 cases[wide ? 'mixed-container' : 'composed-container'] = [`use algo
use numbers
F = 128 fenwick
Tree = F
Cache = new index
Cache 0 = 0
Lookup = Cache
A = array shape 128 fill 0
Total = ${wide ? '10 ** 30' : '0'}
for I in 0 till 12000
 K = I mod 128
 A K += 1
 Tree K = A K
 Lookup K = F K
 Total += (Cache K) + (I gcd 6)
end
Total`, compositionTotal + (wide ? 10n ** 30n : 0n)];
}
const counts = new Array(128).fill(0);
let mixedTotal = 10n ** 30n;
for (let i = 0; i < 12000; i++) {
 counts[i % 128] += gcd(i, 6);
 mixedTotal += BigInt(counts[i % 128]);
}
cases['mixed-composed'] = [cases['mixed-container'][0]
 .replace('A K += 1', 'A K += I gcd 6')
 .replace('Total += (Cache K) + (I gcd 6)', 'Total += Cache K'), mixedTotal];
cases.index = ['use algo\nCache = new index\nTotal = 0\nfor I in 0 till 12000\n Cache I = I\n Total += Cache I\nend\nTotal', 71994000n];
for (const seeded of [false, true]) {
 cases[seeded ? 'overlay-replay' : 'empty-replay'] = [`use algo
F = 128 fenwick
Alias = F
Cache = new index
${seeded ? 'Cache -1 = 7' : ''}
A = array shape 128 fill 0
Wide = 0
for I in 0 till 12000
 K = I mod 128
 A K += 1
 Alias K += 1
 Cache K = A K
 Wide = 9007199254740990 + I
end
(F sum 127) + (A sum) + (Cache 0) + Wide`, 9007199254777083n];
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
 const start = performance.now();
 const result = stats ? stats.run(() => runtime.executeProgram(program)) : runtime.executeProgram(program);
 const milliseconds = performance.now() - start;
 assert.equal(result, expected);
 global.gc();
 // runtime remains reachable: these are retained process totals, not allocation counts.
 const retained = process.memoryUsage();
 const variables = runtime.variables.size;
 runtime.dispose();
 console.log(JSON.stringify({ milliseconds, result: String(result), variables,
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
 const selected = options.cases ? options.cases.split(',') : ['scalar', 'dense', 'sparse', 'grouped', 'container', 'replay'];
 for (const name of selected) assert(name in cases, name);
 const versions = [
  ...(options.baseline ? [{ name: 'baseline-off', root: resolve(options.baseline), enabled: 'off' }] : []),
  { name: 'candidate-off', root, enabled: 'off' }, { name: 'candidate-on', root, enabled: 'on' },
 ];
 const report = { date: new Date().toISOString(), cpu: cpus()[0].model, arch: process.arch,
  node: process.version, revision: process.env.REVISION ?? execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  samples, scope: 'fresh-process executeProgram; parsing excluded; forced GC with live runtime',
  cases, observations: [], ratios: {} };
 for (let sample = 0; sample < samples; sample++) {
  for (const name of selected) for (const engine of ['reference', 'compiled']) {
   const ordered = sample % 2 ? [...versions].reverse() : versions;
   for (const version of ordered) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--worker', version.root, name, engine, version.enabled],
     { encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
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
