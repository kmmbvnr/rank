// Build first: npm run langium:generate && npx tsc -b tsconfig.build.json
// --quick: the issue workload only. --real: Float64 input storage. --runtime=/absolute/path/to/out/index.js
// compares another checkout without changing this benchmark's workload.
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';
const runtimePath = process.argv.find(arg => arg.startsWith('--runtime='))?.slice(10);
const { Interpreter, RuntimeDiagnostics } = await import(runtimePath ? pathToFileURL(runtimePath).href
  : '../packages/interpreter/out/index.js');
const quick = process.argv.includes('--quick');
const real = process.argv.includes('--real');
const sizes = quick ? [10000] : [10000, 65537, 1000000];
const squareSum = n => n * (n + 1n) * (2n * n + 1n) / 6n;
const variants = {
  whole: 'B - B',
  distinct: 'B - C',
  ranges: '(B (L to #)) - (B (0 till Size - L))',
  slices: '(B drop L) - (B take (Size - L))',
  strided: '(B (L to # by 2)) - (B (0 till Size - L by 2))',
};
function expected(name, size, iterations) {
  if (name === 'whole') return 0n;
  if (name === 'distinct') return BigInt(size * iterations);
  let total = 0n;
  for (let l = 1n; l <= BigInt(iterations); l++) {
    const n = BigInt(size);
    if (name === 'strided') {
      const count = (n - l + 1n) / 2n;
      // Sum ((1 + 2i + l)^2 - (1 + 2i)^2).
      total += count * l * l + 2n * l * count * count;
    } else total += squareSum(n) - squareSum(n - l) - squareSum(l);
  }
  return total;
}
const initialize = size => `use sequences\nSize = ${size}\nN = 1 to Size array\nB = ${real ? '((N real rank 0) copy) ** 2' : 'N * N'}\nC = B - 1`;
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
  storage: real ? 'Float64' : 'BigInt',
  timing: 'loop parse and execution; setup and process startup excluded; three trials' }));
for (const size of sizes) {
  const iterations = size === 1000000 ? 20 : 668;
  for (let trial = 0; trial < 3; trial++) for (const [name, expression] of Object.entries(variants)) {
    const runtime = new Interpreter();
    const setupStart = performance.now();
    runtime.execute(initialize(size));
    const setupMs = performance.now() - setupStart;
    const start = performance.now();
    const result = runtime.execute(`Total = ${real ? '0.0' : '0'}\nfor L in 1 to ${iterations}\n  R = ${expression}\n  Total += R sum\nend\nTotal`);
    const ms = performance.now() - start;
    assert.equal(result, real ? Number(expected(name, size, iterations)) : expected(name, size, iterations));
    console.log(JSON.stringify({ size, iterations, trial, name, ms, setupMs, result: String(result) }));
    runtime.dispose();
  }
}
// Observe dispatch separately: counters must not distort the timings above.
for (const [name, expression] of Object.entries(variants)) {
  const runtime = new Interpreter(), diagnostics = new RuntimeDiagnostics();
  runtime.execute(initialize(10000) + '\nL = 1');
  diagnostics.run(() => runtime.execute(`R = ${expression}\nR sum`));
  console.log(JSON.stringify({ name, cellsComputed: diagnostics.cellsComputed,
    cowCopies: diagnostics.cowCopies, selectionSnapshotCells: diagnostics.selectionSnapshotCells }));
  runtime.dispose();
}
