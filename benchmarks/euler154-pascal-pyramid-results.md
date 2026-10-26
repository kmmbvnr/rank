# Euler 154: Number read buffers and binomial pruning

Measured on Apple M5, Node v24.15.0, 2026-10-26, based on `22abb7b0`.
Three serial fresh-process samples per completed timed variant, alternating
variant order. Timings include parsing and complete execution. Diagnostics and
oracle validation are separate from the timed demand. Peak RSS is the child
process high-water mark before validation, not retained memory.

## Separate changes

The original demo declares `Is'`, a deferred candidate vector. The outer loop's
entry guard declines this input. Its inner loop still runs in a Number region,
but that region is entered 64,973 times. Each entry previously converted the two
200,001-cell valuation tables to private numeric buffers: approximately 26 billion
cell conversions in addition to the actual search. The archived
[original source](fixtures/euler154-original.ra) preserves this workload.

The runtime change caches prepared read-only numeric buffers inside the compiled
region. Keys are weak references to owned eager arrays. Tracked revision and cell
domain guard reuse; stores and new input objects invalidate or select another
entry. Writable buffers remain private to each invocation, even when another
input aliases the same source. Existing direct packed reads remain unchanged.
The cache holds converted storage, not a deferred expression result. It does not
force plans, add language-level memoization, or move ordinary completion boundaries.

The demo also changes `Is' =` to ordinary `Is =`, allowing both nested loops to
share one Number region. This source change and read-buffer reuse are alternative
ways of avoiding repeated preparation here; their speedups should not be multiplied.
Compilation of arbitrary deferred external iterables into the surrounding region
is still unsupported.

Finally, the demo strengthens its outer candidate pruning. For `M = N - I`,
the largest exponent of 5 among `C(M, J)` is

```
floor(log_5(M + 1)) - v_5(M + 1)
```

This follows by counting possible base-5 carries: trailing digits equal to 4 in
`M` cannot begin a carry; above them the maximum carry chain spans the remaining
nonleading positions. The formula also gives zero when `M = 5^k - 1`.
Integer comparisons against powers of five and divisibility counts compute this
bound for every candidate in array expressions, avoiding floating logarithms.
An outer candidate is impossible when its exponent in `C(N, I)` plus this maximum
is below `Power`. The search still checks both prime valuations and all symmetry
weights for the remaining pairs.

## Full default: N=200000, Power=12

| Variant | Median execution | Median peak RSS | Candidates | Pairs visited |
| --- | ---: | ---: | ---: | ---: |
| Original source, original runtime | Stopped at 60 s | Not recorded | — | — |
| Original source, read-buffer reuse only | 12.734 s | 591.6 MiB | 64,973 | 3,226,902,876 |
| Only `Is =`, original runtime | 12.709 s | 592.1 MiB | 64,973 | 3,226,902,876 |
| Final: read-buffer reuse, `Is =`, stronger pruning | **9.872 s** | **607.8 MiB** | **49,733** | **2,268,541,659** |

All completed runs return **479742450**. The old runtime/default observation is
one bounded execution terminated by the process watchdog, not a completed timing
or a median. No exact full-default before/after speedup ratio is claimed.

Relative to candidate completion alone, stronger pruning removes 29.7% of visited
pairs and reduces execution time by 22.3%. Its extra tables increase peak RSS by
about 15.7 MiB (2.7%). This is a speed improvement with a modest memory cost.
The remaining 2.27 billion pair visits still dominate the final algorithm.

Separate full-default diagnostics show:

| Variant | Number regions entered | Read buffers prepared | Read-buffer cells prepared | Cache hits | Overflows |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original source, new runtime | 64,973 | 2 | 400,002 | 129,944 | 0 |
| Final demo, new runtime | 1 | 3 | 449,735 | 0 | 0 |

The source-only `Is =` variant also enters one Number region. The old runtime
does not expose the new buffer counters; the approximately 26-billion baseline
conversion count is derived from its preparation code, table sizes and number
of entries, not presented as an instrumented counter.

## Medium input and fixture

For `N=10000, Power=6`, the original source visits 8,338,334 pairs and returns
40876875. Runtime-only buffer reuse reduces its median from **1.264 s to
0.326 s** (3.9 times faster). It still enters the same 3,334 Number regions;
diagnostics show just two prepared read buffers, 20,002 converted cells and
6,666 cache hits. Candidate completion alone takes 0.308 s. The stronger bound
barely prunes this input, and the final demo takes 0.325 s; this small input does
not show the full-default algorithmic gain.

The original fixture already uses only `N=100,300,500`, with no repeated default
execution. Its source and all three assertions remain unchanged.

| Fixture engine | Original | Final |
| --- | ---: | ---: |
| Compiled | 0.167 s | 0.162 s |
| Reference | 0.212 s | 0.205 s |

These small differences are not claimed as a material fixture speedup. The full
reference default was not timed. The existing differential-default exclusion,
test lanes and deadlines remain unchanged.

## Verification and reproducibility

- The benchmark's independent full oracle enumerates all **3,333,433,334** sorted
  triples, without either outer pruning rule. It uses the digit-sum identity for
  factorial valuations, rather than the demo's Legendre tables. Exactly
  80,576,864 triples pass the five-adic condition; the final weighted answer is
  479742450. Every completed timed run checks its answer and printed output.
- New Euler tests compare exact multinomial coefficients built from BigInt
  factorials against both engines for 15 inputs, including zero, powers of five
  and their neighbours. A further test requires one Number region and no overflow.
- Eleven read-buffer tests compare full state/errors with reference execution
  and the exact compiled backend. They cover reuse, stores, rebinding, COW aliases,
  unsafe cells, overflow replay, bounds errors, real/boolean cells and matrices.
- The ordinary interpreter suite passes **8622 tests in 379 files**, excluding
  the separate type, differential and Nurikabe suites. TypeScript build, semantic
  boundaries (65 owners), and application-form checks pass.
- Both scoped fixture audits pass: inferred types against runtime values, and
  compiled/reference differential execution. The full default is not selected
  by these existing corpus lanes; its answer is checked by the separate full
  benchmark and oracle above.

Frozen paired runtimes differ in exactly two JavaScript modules:
`number-loop-runtime.js` and `diagnostics.js`. This isolates the runtime change
from other workspace work. Raw files include source and runtime module hashes,
all samples, oracle counts, tests, timeouts and separate diagnostic runs.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-pascal-pyramid.mjs --samples=3 \
  --before-runtime=/path/to/baseline/out/index.js --versions=ready,compiler,pruned
node benchmarks/euler-pascal-pyramid.mjs --samples=1 --deadline=60000 \
  --before-runtime=/path/to/baseline/out/index.js --versions=before
node benchmarks/euler-pascal-pyramid.mjs --samples=3 --cases=medium \
  --before-runtime=/path/to/baseline/out/index.js
node benchmarks/euler-pascal-pyramid.mjs --samples=3 --cases=fixture \
  --before-runtime=/path/to/baseline/out/index.js --versions=before,compiler,pruned
node benchmarks/euler-pascal-pyramid.mjs --samples=3 --cases=fixture --engine=reference \
  --before-runtime=/path/to/baseline/out/index.js --versions=before,pruned
node benchmarks/euler-pascal-pyramid.mjs --samples=1 --diagnostics=true \
  --before-runtime=/path/to/baseline/out/index.js --versions=ready,compiler,pruned
```

The driver also accepts `--runtime=` for a frozen candidate build. `before` and
`compiler` use the exact archived source; `ready` changes only `Is' =` to `Is =`;
`pruned` uses the final demo. Timeout records are preserved without substituting
their deadline as an execution time.

Raw results: [compiled default](baselines/2026-10-26-euler154-compiled.json),
[bounded original default](baselines/2026-10-26-euler154-before.json),
[medium](baselines/2026-10-26-euler154-medium.json),
[fixture](baselines/2026-10-26-euler154-fixture.json),
[reference fixture](baselines/2026-10-26-euler154-reference.json),
[full diagnostics](baselines/2026-10-26-euler154-diagnostics.json),
[medium diagnostics](baselines/2026-10-26-euler154-medium-diagnostics.json).
