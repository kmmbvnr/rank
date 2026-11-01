// Completed numeric producers and copies, with full output forcing.
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
  cosine: `fun X transform\n return X cos copy\nend`,
  squareRoot: `fun X transform\n return X sqrt copy\nend`,
  real: `fun X transform\n return X real copy\nend`,
  gather: `fun X transform Indices\n return X Indices copy\nend`,
  tupleGather: `fun X transform Indices\n return tuple (X Indices)\nend`,
  copy: `fun X transform\n return X copy\nend`,
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
    timing: 'serial fresh processes, alternating order; >=1000 ms warmup, three target 300 ms batches; function entry/return, output allocation and host-array forcing included; input and independent oracle prepared outside timing',
    sources, results, summary };
  if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} else {
  const name = values.worker; assert(name in sources);
  const checkout = values.checkout ?? root;
  const { Interpreter, RuntimeDiagnostics } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
  const { typedArray } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/array-storage.js')));
  const runtime = new Interpreter(() => {}); runtime.execute('use numbers\nuse sequences\n' + sources[name]);
  const n = 4096;
  const cells = Float64Array.from({ length: n }, (_, i) => 2 + Math.sin(i * .37));
  const indices = Int32Array.from({ length: n }, (_, i) => (i * 17) % n);
  const input = name === 'real' ? Int32Array.from({ length: n }, (_, i) => i) : cells;
  const args = [typedArray(input, [n], undefined, name === 'real' ? 'integer' : 'real')];
  if (name === 'gather' || name === 'tupleGather') args.push(typedArray(indices));
  const fn = runtime.variables.get('transform'), run = () => { const out = fn.call(args); return name === 'tupleGather' ? out.items[0].items : out.items; };
  const expected = Array.from(input, (x, i) => name === 'cosine' ? Math.cos(x)
    : name === 'squareRoot' ? Math.sqrt(x) : name === 'gather' || name === 'tupleGather' ? input[indices[i]] : x);
  const check = actual => { assert.equal(actual.length, expected.length); for (let i = 0; i < expected.length; i++) assert(Math.abs(actual[i] - expected[i]) < 1e-12); };
  check(run()); let count = 0, start = performance.now();
  while (performance.now() - start < 1000 || count < 3) { run(); count++; }
  const probe = performance.now(); run();
  const iterations = Math.max(3, Math.ceil(300 / Math.max(.001, performance.now() - probe)));
  const batches = [];
  for (let batch = 0; batch < 3; batch++) {
    const cpu = process.cpuUsage(); start = performance.now(); let result;
    for (let i = 0; i < iterations; i++) result = run();
    const ms = (performance.now() - start) / iterations, used = process.cpuUsage(cpu); check(result);
    batches.push({ ms, cpuMs: (used.user + used.system) / 1000 / iterations });
  }
  const ms = median(batches.map(b => b.ms)), cpuMs = median(batches.map(b => b.cpuMs));
  const diagnostics = new RuntimeDiagnostics(); diagnostics.run(run);
  console.log(JSON.stringify({ name, n, iterations, ms, cpuMs, batches,
    sourceHash: createHash('sha256').update(sources[name]).digest('hex'), diagnostics }));
  runtime.dispose();
}
