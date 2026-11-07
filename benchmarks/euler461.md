# Euler 461: Almost Pi

The full N=10000 answer remains **159820276**, attained by
**1433, 2147, 4903, 11363**. The imported N=200 and N=1000 fixtures retain
64658 and 1519860. The issue's historical 2.8-minute / 5-GB figure is not the
fresh baseline on the current runtime.

## Program and correctness

The original meet-in-the-middle method was appropriate: replace four nested
searches with two lists of pair sums. Its implementation stored and sorted
both lists, then repeatedly allocated merged values, argsort permutations,
neighbor positions and masks. About 72 million pairs are considered at the
full default. Array allocation, sorting and merge preparation dominate;
there was no missing elementary number-theory shortcut in this change.

The program now stores one sorted list (about 29 million smaller pair sums).
It flattens ragged row intervals in bounded chunks using prefix counts and
`upperindex`. The larger list (about 43 million pairs) is streamed rather
than retained or sorted. `lowerindex` finds both neighboring smaller sums.
Candidates within the current best error plus a rounding allowance are kept,
then their integer pairs are recovered and checked with the existing
40-digit exponential series. Candidate Cartesian products and series terms
use matrices rather than nested Rank loops. Each function has at most one
loop; the main program has none. Lines remain within 40 columns.

The search bounds now come from an actual incumbent: the best one-term
approximation, with three zero terms, bounds the optimum four-term error.
Pair bounds are widened by that error and a small floating-point guard.
The old fixed 1e-9 window assumed the answer was already extremely close;
it returned 0 for N=1. The new result is 2, matching exhaustive high-precision
search (two zero terms and two terms at k=1). This fixes a parameterized
correctness boundary, as well as avoiding an unproved 1000/N^4 near-miss
threshold. The double-precision candidate envelope remains a numerical
screen, followed by the 40-digit comparison; it is not an arbitrary-precision
proof for every possible larger N.

`C` remains the public chunk option, but its default falls from 4000000 to
262144. Exploratory comparisons of 1000000 and 262144 on the new program
showed essentially unchanged elapsed time with less peak RSS for the smaller
chunk. This is a measured default for these hosts, not a universal optimum.

## General compiler and runtime changes

- Number vector recipes now lower integer/real `lowerindex` and `upperindex`
  batches, including tensor-shaped queries and use as gather selectors.
  A private search hint gallops from the previous answer in either direction.
  Each ordinary array binding still completes its values. NaNs, unsafe integer
  inputs, unsupported bindings and observable polling retain exact replay or
  the ordinary path. The existing scalar search implementation is unchanged;
  the batch helper has a separate generated-code argument.
- Numeric vector RHS values and real scalar fills can be written to a rank-one
  arithmetic range in a Number region. The range is checked before the RHS,
  the RHS completes before stores, and overlapping operands are snapshotted.
  Widening, assignment results, error order and budgeted boundaries are kept.
  Existing direct integer slice transfers retain their specialized path.
  Managed aliases whose range-write ownership is not proved still decline
  compilation through the existing region checks.
- Repeated real search batches share a revision-checked NaN-free source proof.
  Small batches accumulate the same search-work estimate used for admission,
  rather than forever declining a source proof just above one batch's budget.
  Successful proofs are reused until a write changes the owned source revision.
  Unknown, shared, lazy or observable inputs retain the ordinary path; NaN
  proofs decline instead of exposing errors from undemanded search cells.
- Exclusive self-rebinding native sort now also accepts Float64 storage after
  proving that native ordering agrees. NaNs and negative zero retain generic
  ordering, and retained aliases/readers, shared buffers and interruption keep
  the existing conservative path. This is a general capability; the final
  demo's function-result ownership does not make its sort eligible to consume
  the returned buffer in place.

No language syntax, numeric precision limits or Number admission constants
were changed. Transactional private buffers still have a cost: in the
same-source control, enabling the new compiler/runtime paths can use more RSS
than the old runtime on that array program. The final algorithm nevertheless
uses substantially less memory than the original program on both hosts.

## Verification

- Independent exhaustive sorted quadruple searches at twelve small N values,
  using 60-digit exponential sums and a separately computed Machin-series pi,
  compared against Number, exact compiled and reference execution.
- N=200 fixtures at three chunk sizes, N=1000 on all three backends, and the
  full golden answer plus all four winning terms.
- New tests cover tensor batches, forward/backward/repeated targets, aliases,
  source edits, empty/wide inputs, late errors, NaNs, range strides and empty
  writes, overlap snapshots, widening, RHS results, budgets and real sort
  ordering. Cached proofs are invalidated by native writes, including NaN.
- **2397 focused checks in 83 files passed on Mac and Intel.** The broad run
  includes earlier Euler fixes, polling, ranges, tensor stages, array ownership,
  manual/operation contracts and all new regressions. Source/test TypeScript,
  application-form and semantic-boundary checks passed on Mac. Exhaustive
  corpus audits were not run.

## Measurements

| Host | Workload | Before → after, seconds | Before → after, peak RSS MiB |
| --- | --- | --- | --- |
| mac | compiled N=10000 (3 pairs) | 32.386 → 18.592 | 4800.8 → 1059.1 |
| mac | same new source compiled (1 pair) | 31.205 → 18.711 | 903.9 → 1059.3 |
| mac | reference N=1000 (3 pairs) | 0.660 → 0.344 | 416.7 → 334.9 |
| mac | reference N=10000 (1 pair) | 45.794 → 24.705 | 4923.8 → 1107.7 |
| mac | unchanged Euler459 compiled (1 pair) | 9.411 → 9.418 | 214.8 → 211.6 |
| intel | compiled N=10000 (3 pairs) | 69.959 → 34.803 | 2610.6 → 837.4 |
| intel | same new source compiled (1 pair) | 57.259 → 36.851 | 829.8 → 771.5 |
| intel | reference N=1000 (3 pairs) | 1.686 → 0.829 | 392.6 → 303.7 |
| intel | reference N=10000 (1 pair) | 108.351 → 50.972 | 2821.4 → 1106.2 |
| intel | unchanged Euler459 compiled (1 pair) | 22.055 → 21.275 | 201.1 → 200.6 |

[All raw measurements and ranges](baselines/2026-11-07-euler461.json) retain 36 accepted final samples.

`full-compiled` has three alternating fresh-process pairs per host.
`small-reference` likewise uses three pairs at N=1000. `same-source` is one
full-input pair of the **same new array program** on old/new runtimes, separating
implementation effects from the algorithm rewrite. `full-reference` is one
full-input pair with compilation disabled. These single pairs are diagnostic
controls, not three-run median estimates. `compat459` uses the unchanged
Euler 459 source in one full compiled pair to check the scalar-search path.

Full compiled medians improve by about 1.74x on Mac and 2.01x on Intel,
with peak RSS reduced by about 78% and 68%. The same-source compiler/runtime
control raises Mac RSS by about 17%, while lowering it by about 7% on Intel.
The unchanged Euler 459 control is effectively flat on Mac and slightly
faster on Intel; one pair cannot establish a statistical cross-program guarantee.

The base is f8ef186d. Both hosts use Node v24.15.0 (arm64 Mac and x64 Intel
Core i7-10750H). Timings include parsing, analysis and execution, excluding
process startup. RSS is process-lifetime peak. Foreign Node jobs are checked
before and every second during runs; Intel requires at least 98% idle CPU
and no active swap before each sample. Interrupted series resume their exact
accepted prefix. Contaminated preliminary/control attempts are discarded;
all accepted final samples and ranges are retained in the artifact.

Peak RSS depends on GC scheduling: exploratory Mac baselines used less memory
than the final controlled baseline, with identical diagnostic work counts.
Exploratory timings are not mixed into the final medians. Memory reductions
refer to the final algorithm against the original program, not to a claim that
all compiler controls allocate less. The complete default remains manual for
repeated corpus audits; the small fixture and separate full compiled golden
check remain enabled.

A possible follow-up is to restrict successful fresh-array function-prefix
publication to its returned array, as scalar reductions already do. This was
not implemented or measured here, and no memory/speed benefit is claimed for it.

Reproduce after building language and interpreter, from the repository root:

```sh
node benchmarks/euler461.mjs compiled
node benchmarks/euler461.mjs reference
node benchmarks/euler461.mjs compiled 1000
node benchmarks/euler461-compare.mjs /path/to/built-f8ef186d /tmp/results.jsonl mac full-compiled
```

The comparison driver accepts `intel` on Linux, plus `same-source`,
`small-reference`, `full-reference` and `compat459` workloads. Existing matching
JSONL results resume without being truncated. `RANK461_RUNTIME` selects a built
interpreter entrypoint and `RANK461_DIAGNOSTICS=false` disables counters.
