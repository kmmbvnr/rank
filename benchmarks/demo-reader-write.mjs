import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';
import { arrayForWrite, noteArrayBinding, ownedArray } from '../packages/interpreter/out/array-storage.js';

const size = Number(process.argv[2] ?? 2048);
const calls = Number(process.argv[3] ?? 16);
assert(Number.isSafeInteger(size) && size >= 2);
assert(Number.isSafeInteger(calls) && calls > 0);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const runtime = new Interpreter();
try {
  const originalBorrowCandidates = runtime.borrowCandidates.bind(runtime);
  const demos = [
    { name: 'max_subarray', path: 'demos/cses/sortnsrch/008_maxsubarray.ra', values: [1n] },
    { name: 'best_score', path: 'demos/atcoder/edpc/03_vacation.ra', values: [1n, 2n, 3n] },
  ].map(item => {
    const source = readFileSync(item.path, 'utf8');
    runtime.execute(source.slice(source.indexOf(`fun ${item.name}`)));
    return { ...item, fn: runtime.variables.get(item.name) };
  });
  const cases = demos.flatMap(item => [false, true].flatMap(writeAfterCall =>
    [false, true].map(inferredBorrowing => ({ ...item, writeAfterCall,
      inferredBorrowing, times: [], copies: [], copiedCells: [], checksums: [],
    }))));
  const measure = item => {
    runtime.borrowCandidates = item.inferredBorrowing ? originalBorrowCandidates : () => new Map();
    const inputs = Array.from({ length: calls }, () => item.values.map(value => {
      const array = ownedArray(Array(size).fill(value));
      noteArrayBinding(array);
      return array;
    }));
    const stats = new RuntimeDiagnostics();
    let checksum = 0n;
    const start = performance.now();
    stats.run(() => {
      for (const arrays of inputs) {
        const result = item.fn.call(arrays);
        assert.equal(typeof result, 'bigint');
        checksum += result;
        if (item.writeAfterCall) {
          for (const [index, array] of arrays.entries()) {
            const writable = arrayForWrite(array) ?? array;
            writable.items[0] = 9n;
            assert.equal(writable.items[0], 9n);
            assert.equal(array.items[1], item.values[index]);
          }
        }
      }
    });
    return { ms: performance.now() - start, checksum: String(checksum),
      copies: stats.cowCopies, copiedCells: stats.cowCopiedCells };
  };
  for (const item of cases) { measure(item); measure(item); }
  for (let round = 0; round < 9; round++) {
    for (const item of round % 2 ? [...cases].reverse() : cases) {
      const result = measure(item);
      item.times.push(result.ms);
      item.copies.push(result.copies);
      item.copiedCells.push(result.copiedCells);
      item.checksums.push(result.checksum);
    }
  }
  for (const item of cases) {
    assert(item.copies.every(count => count === (item.inferredBorrowing || !item.writeAfterCall ? 0 : calls * item.values.length)));
  }
  for (const name of demos.map(item => item.name)) {
    const checksums = cases.filter(item => item.name === name).flatMap(item => item.checksums);
    assert.equal(new Set(checksums).size, 1);
  }
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, size, calls,
    timing: 'fresh owned inputs prepared outside timing; unchanged demo call, optionally followed by one write to each input; two warmups and nine alternating samples per mode',
    control: 'inferredBorrowing=false disables runtime borrowCandidates only; the prepared static proof is empty for both demo functions',
    results: cases.map(item => ({ name: item.name, writeAfterCall: item.writeAfterCall, inferredBorrowing: item.inferredBorrowing,
      medianMs: median(item.times),
      copies: item.copies, copiedCells: item.copiedCells, checksums: item.checksums })) }, null, 2));
} finally { runtime.dispose(); }
