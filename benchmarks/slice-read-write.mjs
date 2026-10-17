// Build first: npx tsc -b tsconfig.build.json
// --quick checks small inputs; --direct-only omits retained intermediates.
import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const quick = process.argv.includes('--quick');
const directOnly = process.argv.includes('--direct-only');
const sizes = quick ? [10000] : [80000, 160000, 320000];
const reference = limit => {
  const phi = Array.from({ length: limit + 1 }, (_, i) => i);
  let primes = 0;
  for (let p = 2; p <= limit; p++) {
    if (phi[p] !== p) continue;
    primes++;
    for (let i = p; i <= limit; i += p) phi[i] -= Math.floor(phi[i] / p);
  }
  return { primes: BigInt(primes), sum: BigInt(phi.reduce((a, b) => a + b, 0)) };
};
function measure(name, limit, initializer, body, expected) {
  const runtime = new Interpreter();
  const diagnostics = new RuntimeDiagnostics();
  const start = performance.now();
  try {
    const value = diagnostics.run(() => runtime.execute(`use sequences
Limit = ${limit}
A = ${initializer}
for P in primes to Limit
 Hits = P to Limit by P
 ${body}
end
A sum`));
    assert.equal(value, expected);
    const result = { name, limit, ms: Math.round(performance.now() - start),
      cowCopies: diagnostics.cowCopies, cowCopiedCells: diagnostics.cowCopiedCells,
      selectionSnapshots: diagnostics.selectionSnapshots, selectionSnapshotCells: diagnostics.selectionSnapshotCells,
      elementTypeScans: diagnostics.elementTypeScans, elementTypeScannedCells: diagnostics.elementTypeScannedCells };
    console.log(JSON.stringify(result));
  } finally { runtime.dispose(); }
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model,
  timing: 'single runs; initialization, parsing and execution included; process startup excluded' }));
for (const limit of sizes) {
  const { primes } = reference(limit);
  const rangeSum = BigInt(limit) * BigInt(limit + 1) / 2n;
  for (const [name, init, initialSum] of [
    ['range', '0 to Limit array', rangeSum],
    ['range-copy', '(0 to Limit array) copy', rangeSum],
    ['fill', 'array shape (Limit + 1) fill 0', 0n],
    ['fill-updated', 'array shape (Limit + 1) fill 1\nA += 1', 2n * BigInt(limit + 1)],
  ]) measure(name, limit, init, 'Seen = A Hits sum\n A P += 1', initialSum + primes);
}
const limit = quick ? 10000 : 1000000;
const { sum } = reference(limit);
measure('totient-direct', limit, '0 to Limit array', 'A Hits -= A Hits // P', sum);
if (!directOnly) measure('totient-named', limit, '0 to Limit array', 'Cut = A Hits // P\n A Hits -= Cut', sum);
