import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
 const match = /^--(root|baseline|samples|case|instrument)=(.+)$/.exec(arg);
 if (!match) throw Error(`Unknown option: ${arg}`);
 return [match[1], match[2]];
}));
const micro = body => `Size = 1000000\nA = array shape (Size + 1) fill 0\n${body}\nAnswer = A sum`;
const cases = {
 scalar: [micro('for I in 0 to Size\n A I += 1\nend'), '1000001'],
 range: [micro('for R in 1 to 6\n A (0 to Size) += 1\nend'), '6000006'],
 stride: [micro('for R in 1 to 6\n A (0 to Size by 2) += 1\nend'), '3000006'],
 indexed: [micro('I = 0 to Size array\nfor R in 1 to 6\n A I += 1\nend'), '6000006'],
 plain: [micro('for R in 1 to 6\n A (0 to Size) = 1\nend'), '1000001'],
 sieve: ['Limit = 1000000\nSigma = array shape (Limit + 1) fill 0\nfor D in 1 to Limit // 2\n Sigma (D * 2 to Limit by D) += D\nend\nAnswer = Sigma sum', '322467618437'],
};
for (const [name, file, expected] of [
 ['euler72', '072_countfractions', '303963552391'],
 ['euler73', '073_fractionsrange', '7295372'],
 ['euler75', '075_singulartriangles', '161667'],
 ['euler86', '086_cuboidroute', '1818'],
 ['euler88', '088_productsum', '7587457'],
 ['euler95', '095_amicablechains', '14316'],
]) cases[name] = [readFileSync(resolve(root, `demos/euler/${file}.ra`), 'utf8'), expected];

if (options.case) {
 const checkout = resolve(options.root ?? root);
 const { Interpreter } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
 const { RuntimeDiagnostics } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/diagnostics.js')));
 const [source, expected] = cases[options.case];
 let loops = 0;
 const r = new Interpreter(() => {}, options.instrument ? { onIntegerLoopExecuted: () => loops++ } : {});
 const d = new RuntimeDiagnostics();
 const run = () => { r.execute(source); assert.equal(String(r.variables.get('Answer')), expected); };
 const start = performance.now();
 if (options.instrument) d.run(run); else run();
 if (options.instrument && typeof d.bulkArrayWrites === 'number') {
  const expectedWork = { range: [6, 6000006], stride: [6, 3000006], indexed: [6, 6000006], plain: [6, 6000006], sieve: [500000, 12970034] }[options.case];
  if (expectedWork) assert.deepEqual([d.bulkArrayWrites, d.bulkArrayWriteCells], expectedWork);
 }
 const elapsedMs = performance.now() - start;
 console.log(JSON.stringify({ elapsedMs, answer: expected, peakRssMiB: process.resourceUsage().maxRSS / 1024,
  ...(options.instrument ? { loops, diagnostics: d } : {}) }));
 r.dispose();
} else {
 const samples = Number(options.samples ?? 3);
 assert(Number.isSafeInteger(samples) && samples >= 3);
 const checkouts = { candidate: resolve(options.root ?? root), ...(options.baseline ? { baseline: resolve(options.baseline) } : {}) };
 const report = { metadata: { date: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, samples,
  timing: 'Fresh processes; execute includes parsing, allocations and verified answer, excludes imports/startup. Microbenchmark instrumentation is separate.',
  sourceHashes: Object.fromEntries(Object.entries(cases).map(([key, [source]]) => [key, createHash('sha256').update(source).digest('hex')])) }, results: {} };
 for (const [name, checkout] of Object.entries(checkouts)) report.results[name] = { checkout, revision: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cases: {} };
 const run = (checkout, key, instrument = false) => {
  const start = performance.now();
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--root=${checkout}`, `--case=${key}`, ...(instrument ? ['--instrument=true'] : [])], { encoding: 'utf8', timeout: 120000 });
  assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
  return { ...JSON.parse(child.stdout), wallMs: performance.now() - start };
 };
 for (let iteration = 0; iteration < samples; iteration++) {
  for (const key of Object.keys(cases)) {
   const versions = Object.entries(checkouts);
   if (iteration % 2) versions.reverse();
   for (const [name, checkout] of versions) {
    const sample = run(checkout, key);
    (report.results[name].cases[key] ??= { samples: [] }).samples.push(sample);
    console.error(`${iteration + 1}/${samples} ${name} ${key}: ${sample.elapsedMs.toFixed(1)} ms`);
   }
  }
 }
 for (const [name, checkout] of Object.entries(checkouts)) for (const key of Object.keys(cases)) {
  const result = report.results[name].cases[key];
  const median = field => result.samples.map(sample => sample[field]).sort((a,b) => a-b)[Math.floor(samples / 2)];
  result.medianMs = median('elapsedMs'); result.medianWallMs = median('wallMs'); result.medianPeakRssMiB = median('peakRssMiB');
  if (['scalar', 'range', 'stride', 'indexed', 'plain', 'sieve'].includes(key)) result.instrumented = run(checkout, key, true);
 }
 console.log(JSON.stringify(report, null, 2));
}
