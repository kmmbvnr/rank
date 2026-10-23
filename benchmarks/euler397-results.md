# Batched factorization and Euler 397 (#395)

`Limit factorsieve` exposes an owned Int32 snapshot of the interpreter's shared
smallest-prime-factor table. Bounds are inclusive, from 0 through 1048575;
entries 0 and 1 are zero. Snapshot mutation cannot change the shared table.
The retained sieve remains capped at 4 MiB; each snapshot has its own storage.

The general factorizer also recognizes exact square residues below 2^64. It
factors the root, using the shared sieve when possible, and doubles each prime's
multiplicity. Existing ascending, lazy, arbitrary-precision behavior is retained.

Euler 397 prepares one SPF table through K. It extracts factors of N, doubles
their exponents and adds one factor of 2 to enumerate divisors of 2*N*N. A single
reused buffer replaces per-N lazy sequences and recursive calls carrying a
mutable index. The original four contribution formulas are accumulated directly.
The existing compiler handles the complete loop, retaining an exact BigInt total
when its initial safe-Number attempt overflows. No compiler changes were needed.

The buffer bound is 2*K+2. If N = 2^a times a product of odd prime powers p^e,
then tau(2*N*N) = (2*a+2) times the product of (2*e+1), at most 2*N because
a+1 <= 2^a and 2*e+1 <= p^e. This bound avoids a fixed capacity tied to the
observed maximum of 4050 divisors.

## Measurements

Apple M5, Node v24.15.0, 2026-10-23. Each sample uses a fresh process. Demo
measurements include parsing, compilation, sieve construction and execution.
Native-factor measurements include product verification for every input.
Reference checksums are computed independently outside the timed region.
The development machine is shared; these results do not establish CI timings.

| Workload | Before | After | Samples |
| --- | ---: | ---: | ---: |
| Native factorization of 2*N*N, N=1..100000 | 1.014 s | 0.181 s | 3 each |
| Same factorization, N=1..1000000 | 15 s timeout in the initial audit | 1.182 s | 3 after |
| SPF table through 1000000, including owned snapshot | unavailable | 18.12 ms | 3 |
| Euler 397, K=100000, X=10^9 | 19.778 s | 2.368 s | 3 each |
| Same reduced demo, square factorization alone | 19.778 s | 19.097 s | 3 each |
| Euler 397, default K=10^6, X=10^9 | 45 s timeout | 16.000 s | 1 before, 3 after |

The isolated square workload improved 5.60x; the complete reduced demo improved
8.35x. Square recognition alone did not establish a substantial end-to-end
improvement: its demo samples ranged from 18.24 to 22.11 s. This is why the
program also uses the batch interface and an iterative traversal.

The three full compiled runs took 15.793, 16.000 and 17.186 s and returned
`141630459461893728`. The original full run was stopped at 45 s; its completion
time and an exact full-input speedup ratio are unknown. An earlier exploratory
full run took 23.27 s, so the repeated medians should not be treated as a fixed
latency guarantee. Reported RSS is process peak, not retained sieve memory.

A separate experiment generated and sorted safe divisors using Numbers instead
of BigInts. On N=1..10000, the three-sample medians were 0.165 s before and
0.171 s after. It was discarded rather than included without a measured benefit.

Raw samples and source/runtime hashes are in `baselines/2026-10-23-euler397-*.jsonl`.
The comparison file alternates the three stages across trials. The original
program is preserved in `fixtures/397-parabola-recursive.ra`; the original
runtime revision is `7734516b`. The square-only snapshot used the candidate
factorizer with the original `modules/numbers.js` and original demo.

## Correctness and checks

- Factorization tests compare adjacent squares with independent trial division,
  including table boundaries, larger roots and values next to a large square.
  Existing replay, lazy demand, arbitrary precision, cancellation and Euler 302
  reduced checks remain covered.
- SPF tests cover sentinel cells, the maximum bound, invalid inputs, ownership,
  copy-on-write and extracting every integer through 10000 in both modes.
- Euler 397 tests compare direct geometric enumeration of small triangles in
  both modes, confirm 41 and 12492, and exercise coordinate bounds above 2^53.
- The compiled default test checks the full answer and verifies that wide
  accumulation is used after a single safe-integer overflow and replay.
- `euler397-oracle.cpp` independently implements the original four-count
  formula using a native SPF sieve and 128-bit totals. Its full answer agrees.

The shared differential-corpus exclusion remains because the reference
interpreter still has to process 101394686 divisors. The full compiled default
has its own targeted test; the small Rank fixture still runs in both modes.
Validation passed: `npm run build` (including web/mobile builds and Capacitor
sync), 93 targeted interpreter tests, 36 language signature tests, the two
execution-exclusion checks, semantic-boundary checks and application-form checks.
The compiled full-input test completed in 17.06 s before integration and
20.03 s after rebasing onto main `da406942`. Integration also required adding
the missing `binary` example to the catalogue test for main's new compiled
profile; all 69 catalogue checks then passed again. No full `npm test` or
complete corpus audit was run for this change.

## Reproduction

```sh
npm run build
npm test --workspace @arrrank/interpreter -- test/factorization.test.ts test/factor-sieve.test.ts test/euler397.test.ts test/operations.test.ts
node benchmarks/euler397.mjs --case=factors --limit=100000 --samples=3
node benchmarks/euler397.mjs --case=sieve --limit=1000000 --samples=3
node benchmarks/euler397.mjs --case=demo --limit=100000 --samples=3
node benchmarks/euler397.mjs --case=demo --limit=1000000 --samples=3
clang++ -O3 -std=c++17 benchmarks/euler397-oracle.cpp -o /tmp/euler397-oracle
/tmp/euler397-oracle 1000000 1000000000
```

Use `--variant=recursive` to run the original source on the selected runtime.
Use `--runtime=/path/to/baseline/packages/interpreter/out/index.js` to select a
built baseline checkout. `--timeout=45000` is the default worker budget in ms;
timeouts are recorded and make the benchmark exit nonzero. To reproduce the
square-only stage, copy the candidate interpreter output and replace only its
`modules/numbers.js` with that from the built baseline. The copy must resolve
`@arrrank/language` through a suitable node_modules link.
