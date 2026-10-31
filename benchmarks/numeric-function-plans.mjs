// General pure array helpers: preparation, indexing proofs and full output forcing.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const root = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: {
  baseline: { type: 'string' }, checkout: { type: 'string' }, worker: { type: 'string' },
  samples: { type: 'string', default: '5' }, output: { type: 'string' },
  only: { type: 'string' },
} });
const sources = {
  affine: `use sequences
fun X transform Scale
 Grid = X reshape # 2
 Shifted = Grid * Scale + 0.5
 return Shifted reshape #
end`,
  indexed: `use sequences
fun X transform Stride
 N = X len
 K = (0 till (N // Stride - 1)) * Stride
 Left = X K
 Right = X (K + Stride)
 return Right - Left
end`,
  pairs: `use sequences
fun X transform Scale
 Grid = X reshape # 2 1
 unpack Left Right = Grid axis 1
 Mid = (Left + Right) * 0.5
 Spread = (Left - Right) * Scale
 Out = concat Mid Spread axis 1
 return Out reshape #
end`,
};
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
if (!values.worker) {
  assert(values.baseline, 'Pass an independently built --baseline');
  assert(!values.only || values.only in sources);
  const names = Object.keys(sources).filter(name => !values.only || name === values.only);
  const samples = Number(values.samples); assert(Number.isSafeInteger(samples) && samples >= 3);
  const versions = { baseline: resolve(values.baseline), candidate: root }, results = [];
  for (const name of names) for (let trial = 0; trial < samples; trial++) {
    for (const version of trial % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`, `--checkout=${versions[version]}`], { encoding: 'utf8', timeout: 60000 });
      assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
      results.push({ trial, version, ...JSON.parse(child.stdout) });
    }
    process.stderr.write(`${name} ${trial + 1}/${samples}\n`);
  }
  const summary = names.flatMap(name => Object.keys(versions).map(version => {
    const rows = results.filter(r => r.name === name && r.version === version);
    return { name, version, medianMs: median(rows.map(r => r.ms)), cpuMedianMs: median(rows.map(r => r.cpuMs)),
      minMs: Math.min(...rows.map(r => r.ms)), maxMs: Math.max(...rows.map(r => r.ms)) };
  }));
  const report = { date: new Date().toISOString(), node: process.version, cpu: cpus()[0].model, versions,
    commits: Object.fromEntries(Object.entries(versions).map(([name, path]) => [name,
      execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()])),
    timing: 'serial fresh processes, alternating order; >=300 ms warmup, target 150 ms batch; function entry/return, output allocation and host-array forcing included; input and independent oracle prepared outside timing',
    sources, results, summary };
  if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} else {
  const name = values.worker; assert(name in sources);
  const checkout = values.checkout ?? root;
  const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
  const { typedArray } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/array-storage.js')));
  const runtime = new Interpreter(() => {}); runtime.execute(sources[name]);
  const n = 4096, cells = Float64Array.from({ length: n }, (_, i) => Math.sin(i * .37) + Math.cos(i * .13));
  const args = [typedArray(cells), name === 'indexed' ? 2n : 1.25];
  const fn = runtime.variables.get('transform'), run = () => fn.call(args).items;
  const expected = name === 'affine' ? Array.from(cells, x => x * 1.25 + .5)
    : name === 'indexed' ? Array.from({ length: n / 2 - 1 }, (_, i) => cells[(i + 1) * 2] - cells[i * 2])
      : Array.from({ length: n }, (_, i) => i % 2 ? (cells[i - 1] - cells[i]) * 1.25 : (cells[i] + cells[i + 1]) * .5);
  const check = actual => { assert.equal(actual.length, expected.length); for (let i = 0; i < expected.length; i++) assert(Math.abs(actual[i] - expected[i]) < 1e-12); };
  check(run()); let count = 0, start = performance.now();
  while (performance.now() - start < 300 || count < 3) { run(); count++; }
  const probe = performance.now(); run();
  const iterations = Math.max(3, Math.ceil(150 / Math.max(.001, performance.now() - probe)));
  const cpu = process.cpuUsage(); start = performance.now(); let result;
  for (let i = 0; i < iterations; i++) result = run();
  const ms = (performance.now() - start) / iterations, used = process.cpuUsage(cpu); check(result);
  const diagnostics = new RuntimeDiagnostics(); diagnostics.run(run);
  console.log(JSON.stringify({ name, n, iterations, ms, cpuMs: (used.user + used.system) / 1000 / iterations,
    sourceHash: createHash('sha256').update(sources[name]).digest('hex'), diagnostics }));
  runtime.dispose();
}
