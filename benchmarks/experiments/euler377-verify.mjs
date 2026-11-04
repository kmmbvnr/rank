import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const modulus = 1_000_000_000n;
// Direct digit-sum DP, independent of the matrix representation.
const counts = Array(13 ** 4 + 1).fill(0n);
const sums = Array(counts.length).fill(0n);
counts[0] = 1n;
for (let n = 1; n < counts.length; n++) {
  for (let d = 1; d <= Math.min(9, n); d++) {
    counts[n] += counts[n - d];
    sums[n] += 10n * sums[n - d] + BigInt(d) * counts[n - d];
  }
  counts[n] %= modulus;
  sums[n] %= modulus;
}
const files = [
  'benchmarks/experiments/euler377-original.ra',
  'demos/euler/377_digitexperience.ra',
  'benchmarks/experiments/euler377-library.ra',
  'benchmarks/experiments/euler377-reuse.ra',
];
let expected = 0n;
const results = [];
for (let terms = 0; terms <= 4; terms++) {
  if (terms) expected = (expected + sums[13 ** terms]) % modulus;
  for (const file of files) {
    for (const mode of ['compiled', 'reference']) {
      const row = JSON.parse(execFileSync(process.execPath, [
        'benchmarks/euler377-investigation.mjs', file, mode, String(terms),
      ], {encoding: 'utf8'}));
      assert.equal(String(row.answer).trim(), String(expected));
      results.push({file, mode, terms, expected: String(expected)});
    }
  }
}
console.log(JSON.stringify(results, null, 2));
