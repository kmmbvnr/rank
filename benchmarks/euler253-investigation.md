# Euler 253: Tidying Up

Investigated against `905c9ea4be2c7662e130f7888cb4ce9561ac6363` after selecting
253 as the first unfinished number in the live #447 inventory (209 remain).
The initial experiments below predate delivery. The final implementation,
comparison and verification are recorded at the end.

## Diagnosis

The reverse-removal state graph is adequate: N=40 reaches 44,583 multisets of
segment lengths and 530,383 weighted transitions. Both phases are dynamic
programming; this is not enumeration of 40! permutations. Arbitrary-precision
base-41 state keys are intentional, and the graph already compiles on the exact
backend. The answer is `11.492847`.

There are two distinct execution problems:

1. The probability stage carries an array recurrence
   `V = V + G (Rt till (Rt + Jm)) * Wt T`. Current loop lowering rejects the
   unbound array-valued V / real-array construction and range selection. It
   compiles only the small final row-store loop, not the whole DP.
2. That small loop accidentally bypasses destination-copy admission. The
   `conditionWriteCells` check in `number-loop-runtime.ts` applies to condition
   loops and root vector traversals, but not ordinary range iterators. Each
   row-store invocation validates/copies all of G, allocates a full dirty mask,
   and scans it during publication. At N=40 G has 1,872,486 cells; doing this for
   approximately 44,583 states processes about 83 billion cells in preparation
   alone. Number-copy-probe counters remain zero. A separate N=30 profile has
   4,424 self samples in the Number runtime entry and 1,788 in its publication
   callback; real tensor arithmetic has only 81 self samples in realKernel.

This explains why enabling compilation can be much slower than reference
execution. It is an admission/copying defect, not slow BigInt arithmetic.

## Controlled comparison

Apple M5, macOS arm64, Node v24.15.0. Three serial fresh processes per variant,
alternating order; imports excluded, parsing/preparation included. No other own
benchmark/test during this cohort. External host load was not controlled.

| Variant | N=30 median, s | N=40 single observation, s |
| --- | ---: | ---: |
| Original, compiled | 9.465 | stopped after >6 minutes* |
| Original, diagnostic copy guard | 1.742 | 13.473 |
| Scalar DP and global width bound, compiled | 0.225 | 0.579 |
| Matrix gather/reduction and slice stores, compiled | 2.189 | 15.037 |
| Original, reference | 2.356 | 16.722 |
| Scalar DP and global width bound, reference | 1.943 | 16.775 |
| Matrix gather/reduction and slice stores, reference | 2.688 | 19.510 |

*The abandoned full original run overlapped some early diagnostic probes;
there is no clean full-default ratio. Only N=30 figures are repeated medians.
The original test comment's "15 min" is historical, not a measured result here.
All completed full runs agree on the answer.

The diagnostic guard only removes the condition around destination-cell
counting. It leaves thresholds/feedback unchanged. It correctly avoids huge
short-loop copies, but also disables useful Number execution on a complete
300,000-element range pass. A complete named-vector pass stays admitted. It is
not a production patch: extend feedback to ranges and retain admission for
provably amortized full passes; preserve overflow replay, aliases, preceding
stores on errors and empty-loop behavior. Do not relax precision thresholds.
Seven synthetic controls match reference results under both runtimes, including
alias snapshots, overflow, bounds errors and empty loops. Performance admission
is the intended difference.

## Source candidates

The simplest fast compiled candidate replaces only the probability accumulation
with a scalar accumulator and bounds its width to `ceil(N / 2) + 1`. No binary
line can contain more than ceil(N/2) occupied segments. The exact backend builds
the graph; one Number region handles the whole real-valued DP, copying its
storage once. This gives about 42x at N=30. It does not by itself materially
accelerate the full reference run.

An additional exact bound is useful without changing the state graph. A state
with lengths L has maximum possible later segment count `sum ceil(L/2)`.
Track this once per new state using the split's delta; set G=1 above that bound
and sum transitions only between the present segment count and this bound.
This candidate took 0.526 s compiled / 13.324 s reference for full N=40 (single
observations). Replacing the state-count row-copy loop by a slice assignment
then took 0.94 s / 12.723 s; the modest reference improvement costs compiled
speed. These later observations are not repeated medians.

Making V eager with `copy` after every transition did not solve the Number
copying problem. A matrix gather/axis reduction preserves an array-style kernel
but its dispatch/allocation costs make it slower than the scalar candidate.
No algorithm replacement is needed before fixing admission and choosing the
source tradeoff. Joining the original array recurrence into a compiled region
remains a general compiler opportunity, beyond simply removing a rejection.

## Verification and reproduction

An independent forward subset DP counts permutations by the maximum occupied
segment count, for N=1..12. Its counts sum to N!, and N=10 matches the official
problem's complete distribution and expectation 385643/113400. Original,
diagnostic-guard, scalar, bounded, pruned, row-copy and matrix-slice candidates
are checked with and without compilation: 168 oracle comparisons in total.
Existing fixture N=6,10,20 also passes in both engines for original, guard,
bounded and pruned variants. Full N=40 is checked separately above. Delivery adds the full-default assertion and edge cases; see below.
No full repository test suite was run for this investigation.

- `node benchmarks/euler253-tidyingup.mjs --runtime=/path/to/interpreter/out/index.js --N=30 --expect=8.842823`
- Add `--reference` for compilation=false, or `--fixture` for the existing test.
- Candidate source texts and raw observations are in
  `benchmarks/baselines/2026-10-28-euler253.json`; extract one `sources` entry to
  a file and pass `--source=/path/to/candidate.ra` to the harness.
- Independent oracle: `benchmarks/experiments/euler253-oracle.py`.
- Official problem: <https://projecteuler.net/problem=253>.


## Delivery

The runtime now applies copy admission to leaf range loops. Work feedback is
created for these loops too; short calls decline repeated private copies after
one bounded probe, and exact execution can promote a later long phase. A range
whose guarded scalar bounds prove a complete unshortened pass retains Number
above the existing probe cap. Bound facts use input slots already checked by
the runtime, without evaluating callbacks, deferred expressions or array cells.
The 64/262144 thresholds, exact arithmetic, overflow replay and publication
contracts are unchanged.

Nested range regions retain their previous admission. Applying the guard to
all ranges sent large nested regions such as Euler 397 and 426 to the exact
backend, losing their existing Number/mixed execution. That broad prototype
was rejected. A general work estimate for nested regions remains open; the
shipping fix is independent of Euler and covers the offending row-store shape.
The ten new range cases include stepped and descending full passes, short/long
phases, early exits, aliases, overflow/errors, empty loops and a nested-work
control. Five fail on the unchanged parent evaluator; all 25 adaptive tests pass.

The demo keeps the same graph and probability recurrence, uses the scalar DP
with both global and state-specific segment bounds, and removes the unused Js.
The state-row slice-copy experiment is not shipped. The full default and
N=1,2,3 edge cases are added to the fixture (two blocks, seven program runs).
Both paths return to the ordinary corpus audits: their full execution is well
within the existing 300-second budget.

### Final controlled measurements

These are a separate, serial fresh-process cohort: three samples per row,
alternating paired runtime order, same M5/Node environment. No own test or
benchmark ran concurrently; external host load was uncontrolled. Raw samples,
RSS, counters, hashes and verification are in
`baselines/2026-10-29-euler253-delivery.json`.

| Workload | Parent, s | Shipping, s |
| --- | ---: | ---: |
| 253-original30 | 8.824 | 1.691 |
| 185 | 0.540 | 0.525 |
| 426 | 1.446 | 1.447 |
| 196 | 1.126 | 1.157 |
| 221 | 1.208 | 1.221 |
| 250 | 0.213 | 0.213 |
| 251 | 2.749 | 2.658 |
| 252 | 1.715 | 1.751 |

| Shipping source | Median, s |
| --- | ---: |
| 253-shipping30 compiled | 0.230 |
| 253-shipping40 compiled | 0.561 |
| Full N=40 original reference | 16.869 |
| Full N=40 shipping reference | 13.618 |

On N=30 the runtime-only fix is about 5.2x faster, and the combined source/runtime
change about 38x. Full compiled shipping N=40 is 0.561 s; there is no completed
controlled full compiled parent baseline, so no full-scale ratio is claimed.
Full reference elapsed time falls about 19.3%. Control median differences are
within roughly +/-3.3%, with overlapping ranges; no general control speedup is
claimed. Answers match for all controls, including exact wide accumulation.
The probability table has 21 columns instead of 42; this is a table-size saving,
not a claim that whole-process peak memory is halved.

### Final validation

- TypeScript build; language 1482/1482; seven focused suites 546/546.
- Ordinary interpreter: 9217 passed, 28 existing failures, exact same failed-name
  set as the parent run. These concern accumulate syntax, reduce pipelines,
  error wording, infinite-string packing and IO arg/option syntax; see raw data.
- Semantic boundary tests: 11 passed, 65 owners; application-form checks passed.
- Both 253 files pass the scoped type audit and full differential observations
  (output, variables, errors and embedded tests). An initial concurrent corpus
  run reported a worker RPC timeout; isolated retries pass without that error.
- 24 additional shipping oracle comparisons for N=1..12 in both engines; the
  independent oracle and 168 historical candidate checks remain available.
- Both CLI file checks: one file checked, zero failures.
- Exhaustive types/differential/Nurikabe audits were not run.
