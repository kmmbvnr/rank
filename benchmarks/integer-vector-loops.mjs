// Whole-loop integer array timing with independent BigInt output oracles.
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
  'warmup-ms': { type: 'string', default: '300' },
  'batch-ms': { type: 'string', default: '150' }, batches: { type: 'string', default: '1' },
  samples: { type: 'string', default: '5' }, only: { type: 'string' }, output: { type: 'string' },
} });
const warmupMs = Number(values['warmup-ms']), batchMs = Number(values['batch-ms']), batches = Number(values.batches);
assert(Number.isFinite(warmupMs) && warmupMs >= 300 && Number.isFinite(batchMs) && batchMs >= 150);
assert(Number.isSafeInteger(batches) && batches >= 1 && batches <= 9);
const formulas = {
  remainder: '(A mod 97) + (A mod 89)',
  quotient: 'A // 3 + A mod 3',
  affine: '(A * 3 + B) // 7',
  broadcast: '(A mod 97) + (B mod 89)',
};
const sources = Object.fromEntries(Object.entries(formulas).map(([name, formula]) => [name, `A = InputA
B = InputB
Count = 12
for Count greater 0
  A = ${formula}
  Count -= 1
end
A`]));
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
if (!values.worker) {
  assert(values.baseline, 'Pass an independently built --baseline');
  assert(!values.only || values.only in sources);
  const names = Object.keys(sources).filter(name => !values.only || values.only === name);
  const samples = Number(values.samples); assert(Number.isSafeInteger(samples) && samples >= 3);
  const versions = { baseline: resolve(values.baseline), candidate: root }, results = [];
  for (const name of names) for (let trial = 0; trial < samples; trial++) {
    for (const version of trial % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--worker=${name}`,
        `--checkout=${versions[version]}`, `--warmup-ms=${warmupMs}`, `--batch-ms=${batchMs}`, `--batches=${batches}`], { encoding: 'utf8', timeout: 60000 });
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
    timing: `Serial fresh processes, alternating order; >=${warmupMs} ms warmup and ${batches} batch(es) targeting ${batchMs} ms. Program execution, twelve whole-array iterations, allocation, publication and complete output forcing included. Input creation, parsing and independent BigInt oracle outside timing; resetting input bindings and program admission included. Workers with multiple batches report their medians.`,
    sources, results, summary };
  if (values.output) writeFileSync(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} else {
  const name = values.worker; assert(name in sources);
  const checkout = values.checkout ?? root;
  const { Interpreter, RuntimeDiagnostics, parse } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
  const { typedArray } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/array-storage.js')));
  const runtime = new Interpreter(() => {}), program = parse(sources[name]);
  const n = name === 'broadcast' ? 64 : 4096;
  const a = Int32Array.from({ length: n }, (_, i) => (i * 17 % 201) - 100);
  const b = Int32Array.from({ length: n }, (_, i) => (i * 13 % 97) - 48);
  const args = name === 'broadcast' ? [typedArray(a, [64, 1]), typedArray(b, [1, 64])]
    : [typedArray(a), typedArray(b)];
  runtime.variables.set('InputA', args[0]); runtime.variables.set('InputB', args[1]);
  const run = () => runtime.executeProgram(program).items;
  const mod = (a, b) => (a % b + b) % b;
  const div = (a, b) => (a - mod(a, b)) / b;
  let expected = Array.from(a, BigInt);
  if (name === 'broadcast') {
    expected = Array.from({ length: 4096 }, (_, i) => mod(BigInt(a[Math.floor(i / 64)]), 97n) + mod(BigInt(b[i % 64]), 89n));
    for (let pass = 1; pass < 12; pass++) expected = expected.map((x, i) => mod(x, 97n) + mod(BigInt(b[i % 64]), 89n));
  }
  else for (let pass = 0; pass < 12; pass++) expected = expected.map((x, i) => name === 'remainder'
    ? mod(x, 97n) + mod(x, 89n) : name === 'quotient' ? div(x, 3n) + mod(x, 3n) : div(x * 3n + BigInt(b[i]), 7n));
  const check = actual => { assert.equal(actual.length, expected.length); for (let i = 0; i < expected.length; i++) assert.equal(actual[i], expected[i], `${name}/${i}`); };
  check(run()); let count = 0, start = performance.now();
  while (performance.now() - start < warmupMs || count < 3) { run(); count++; }
  if (batches > 1) {
    const measured = [];
    for (let batch = 0; batch < batches; batch++) {
      const cpu = process.cpuUsage(), start = performance.now(); let iterations = 0, result;
      do { result = run(); iterations++; } while (performance.now() - start < batchMs);
      const elapsed = performance.now() - start, used = process.cpuUsage(cpu); check(result);
      measured.push({ iterations, ms: elapsed / iterations, cpuMs: (used.user + used.system) / 1000 / iterations });
    }
    const diagnostics = new RuntimeDiagnostics(); diagnostics.run(run);
    assert.equal(diagnostics.numberLoops, 1);
    console.log(JSON.stringify({ name, outputCells: expected.length, measured,
      iterations: measured.reduce((sum, row) => sum + row.iterations, 0),
      ms: median(measured.map(row => row.ms)), cpuMs: median(measured.map(row => row.cpuMs)),
      sourceHash: createHash('sha256').update(sources[name]).digest('hex'),
      diagnostics: Object.fromEntries(['numberLoops', 'compiledLoops'].map(k => [k, diagnostics[k]])) }));
    runtime.dispose(); process.exit(0);
  }
  const probe = performance.now(); run();
  const iterations = Math.max(3, Math.ceil(batchMs / Math.max(.001, performance.now() - probe)));
  const cpu = process.cpuUsage(); start = performance.now(); let result;
  for (let i = 0; i < iterations; i++) result = run();
  const ms = (performance.now() - start) / iterations, used = process.cpuUsage(cpu); check(result);
  const diagnostics = new RuntimeDiagnostics(); diagnostics.run(run);
  assert.equal(diagnostics.numberLoops, 1, 'The numerical array loop must execute');
  console.log(JSON.stringify({ name, outputCells: expected.length, iterations, ms,
    cpuMs: (used.user + used.system) / 1000 / iterations,
    sourceHash: createHash('sha256').update(sources[name]).digest('hex'),
    diagnostics: Object.fromEntries(['numberLoops', 'compiledLoops'].map(k => [k, diagnostics[k]])) }));
  runtime.dispose();
}
