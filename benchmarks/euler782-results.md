# Euler 782: packed flags and fused quadratic forms

Issue: https://github.com/kmmbvnr/rank/issues/559

Size=10000 and the full answer `318313204` are unchanged. The same 46 quadratic
forms, triples of group sizes, rectangles and two-group subset sums are used.
No new mathematical algorithm or problem-specific compiler rule is introduced.

## Runtime, storage, then evaluation

Scalar Boolean indexed writes now update packed words in cancellable batches
when polling is private and neither inspection nor an exact demand budget is
active. Duplicate addresses and both true/false writes are supported. The
caller still validates selectors, snapshots aliases and checks the binding
before mutation. Observable polling retains per-cell storage reloads; exact
budgets retain their exact committed prefix.

The demo's two integer 0/1 arrays become Boolean flags, with `or` and `count`
in place of `bor` and `sum`. Each 100000001-cell bitmap occupies 12500004 bytes,
versus 400000004 bytes for compact Int32 flags. The algorithm still marks the
same addresses. Changing only the flag representation reduced Mac peak RSS
from 1532 MiB to 472 MiB, but did not improve elapsed time (37.48 to 40.62 s).
Adding batched Boolean writes gave 39.75 s / 425 MiB in a separate single run.

The quadratic form previously materialized each intermediate `Cross` and
`Vals` assignment. Its six terms are now named deferred bindings (`Name'`).
The existing compiler combines them into a Number tensor kernel when `Vals`
is demanded. This retains one Rank loop and exact arithmetic; the reference
engine retains the same result without generated code. The solution
continues to use the existing array operations.

At Size=2000, diagnostic counters changed from 4666 to 1336 compiled tensors,
from 46338060 to 338014 range-scanned cells, and from 89439627 to 28106355
published typed cells. The final diagnostic records 666 Number tensors, one
per eligible Lead. These are diagnostic counts, not full-input timing ratios.
The earlier diagnostic also used CPU profiling, so its elapsed time is not
pooled with the unprofiled diagnostic or the full timing series.

## Measurements

Base revision: `6d9f2187`. Node 24.15.0, Apple M5 arm64 and Intel i7-10750H x64.
Each sample starts a fresh process; timings include parsing and exclude module
imports. CPU time and peak RSS are recorded separately. There is one full
original baseline and three final samples per host. Baseline variance was not
measured. Host activity and frequency are uncontrolled; no samples are removed.
The Intel baseline has the same interpreter code from the preceding task;
subsequent main changes before this task only changed demos and reports.

The isolated scatter control performs eight alternating true/false passes over
1048576 permuted addresses and verifies the final bitmap. Three fresh-process
before/after pairs on Mac measured 24.43 ms versus 15.96 ms by median (about
35% faster). This does not attribute the whole-program speedup to the scatter
primitive: deferred form evaluation supplies most of the runtime improvement.

Raw timings, diagnostic counters, profiles and test results are in
`results/euler782/`. The original source is frozen in
`fixtures/euler782-original.ra`.

## Full-input results

| Host | Original seconds | Final seconds | Median speedup | Original peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 37.48 | 10.85 / 11.06 / 10.76 | 3.45x | 1532.31 | 471.77 |
| Intel | 118.21 | 49.48 / 42.66 / 42.30 | 2.77x | 1466.19 | 430.02 |

## Verification and reproduction

The independent oracle enumerates every binary matrix through Size=4 and
minimizes the union of its row and column sets for each number of ones.
Both execution modes also match the
[published examples](https://projecteuler.net/problem=782) and the original
integer-flag solution at larger small sizes. Runtime tests cover word and
poll boundaries, duplicate set/clear addresses, aliases, bounds errors,
inspection, cancellation and exact demand-budget prefixes.

The focused seven-file suite passed all 203 tests on both Mac and Intel.
The TypeScript build, 65 ownership-boundary tests, application-form checks
and five exclusion-policy tests also passed. The stricter cancellation
assertion was checked again on Mac (12 tests).

Implementation commits: `3b91f5a2` (runtime) and `aad48b6f` (demo and oracle).

Build the runtime before each fresh-process sample:

```sh
EXPECTED=318313204 node benchmarks/euler782.mjs
RANK_SOURCE=benchmarks/fixtures/euler782-original.ra \
  EXPECTED=318313204 node benchmarks/euler782.mjs
node benchmarks/experiments/euler782-scatter.mjs
```

Use the original runtime for the original baseline. `RANK_ROOT` chooses an
independent built checkout. A first argument changes Size; a second argument
`reference` disables compilation. `DIAGNOSTICS=1` and
`PROFILE=path.cpuprofile` enable separate instrumentation.

The under-30-second target is met on Mac, not on this Intel host. The full demo
remains excluded from corpus audits. Full suites and exhaustive audits were
not run.
