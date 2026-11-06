# Euler 742: stored integer extrema and filled shifts

Issue: https://github.com/kmmbvnr/rank/issues/545

Default input remains Vertices=1000, Reach=40, Width=2400. Every full run
returned `18397727`. The primitive directions, slope order, number of states
and 0/1 knapsack recurrence are unchanged.

## Full-input measurements

Node v24.15.0, Apple M5 arm64 macOS and Intel i7-10750H x64 Linux.
One baseline and three serial final fresh-process runs per host, normal CPU
affinity. Machine load and frequency were not controlled. Baseline variance
was not measured. These are end-to-end execution times, including parsing;
CPU time and process peak RSS are separately recorded in the raw JSON.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 71.11 | 6.13 / 5.56 / 5.66 | 12.56x | 404.80 | 293.00 |
| Intel | 162.33 | 15.40 / 15.70 / 15.28 | 10.54x | 395.20 | 280.39 |

Median process peak RSS fell by 27.6% on Mac and 29.1% on Intel. Every final
peak was below the baseline. RSS includes the JS heap and runtime; it is not
an allocation count or a measurement of live DP storage alone.

Raw data: `results/euler742/base-*-full.json`, `final-*-{1,2,3}.json`.
Derived values: `results/euler742/summary.json`. Baseline: `70ba2131`, with
source frozen in `fixtures/euler742-original.ra`.

## Interpreter first

A diagnostic CPU profile at Vertices=200, Reach=20, Width=400 identified
stored integer arithmetic, `chooseStoredIntegers` and cell materialization as
major costs. Summed self-sample counts are retained in `profile-summary.json`;
short profiles are diagnostic, not statistically precise full-input timings.

Two general changes improve the original, unmodified source:

- Int64 `min`/`max` compare signed high words followed by unsigned low words.
  Results remain exact across +/-2^53 and the signed Int64 limits, with no
  BigInt operation per cell. Mixed Int32/Int64 operands, scalars and linear
  selections use the same representation. Arbitrary precision and unsupported
  storage retain the existing exact path.
- A completed numeric `shift` with a nonzero fill copies native typed runs
  and a bounded typed padding block through the existing block-copy helper.
  It preserves type checks, lazy demand for opaque sources, cancellation and
  demand budgets. It does not unpack moved cells into boxed BigInts.

With both changes and the original Rank source, a single full run measured
12.12 seconds on Mac (5.87x) and 30.64 seconds on Intel (5.30x). Peak RSS was
351.92 and 338.70 MiB. Thus the runtime changes alone meet the requested
several-fold improvement. The Intel runtime-only diagnostic was not isolated
from subsequent test activity; use the final series for the primary comparison.

The reduced Mac profile went from 681 ms before changes to 569 ms after word
extrema and 263 ms after filled shifts. These short runs include startup and
parsing and should not be extrapolated as full-input speedups.

## Rank storage and layout

The original `4e18` unreachable sentinel forced Int64 table storage. For a
feasible prefix, Column <= Width and Run,Rise <= Reach, so one transition
adds at most:

```
Limit = 4*Width*Reach + 4*Reach + 2*Reach*Reach
```

There are at most Edges transitions. `Edges*Limit+1` is therefore strictly
above every feasible prefix cost. The implementation caps this at the old
sentinel, preserving its old behavior for unusually large costs. At defaults,
the new sentinel is 96452641 and sentinel plus the maximum increment is
96840001; both fit Int32. All increments are nonnegative. An unreachable state
cannot improve a reachable state. If no solution is found within Reach/Width,
the external result remains the original `4000000000000000001`.

The table is now `[Quarter, Side]`. Shifting the count axis by one and the
column axis by Run is the same predecessor relation as a flat shift by
Side+Run followed by a Column>=Run mask. The axis boundaries remove wraparound
without constructing a mask and `choose` tensor at every step. Grow is one
row broadcast over the counts, rather than a repeated full-table vector.
`Before` retains the previous iteration for the same 0/1 recurrence.

No search bounds were reduced, directions removed, or DP algorithm replaced.
The source still contains one loop and uses ordinary eager array operations.

## Rejected experiments

All exploratory measurements remain in `results/euler742/` with descriptive
prefixes. They are not pooled into the final series.

- `bounded-*`: old flat layout with only the proved finite sentinel.
- `matrix-*`: lazy intermediate matrix shifts; full Mac 18.92 seconds.
- `layout-*`: experimental Number tensor shift compilation; full Mac 34.26
  seconds. Number tensor preparation succeeded, but the generated per-cell
  indexing/checking cost made it slower. The implementation was removed;
  `experiments/euler742-layout-shift-rejected.patch` retains the experiment.
- `eager-*`: initial eager matrix trial, full Mac 5.62 seconds. The final
  source uses this approach and was measured again in the primary series.

## Verification and reproduction

On both Mac and Intel, 120 focused tests passed, covering Euler 742 small
subset enumeration, published A(40)=1039 and A(100)=17473 in both compilation
modes, signed Int64 extrema and arbitrary precision, typed shifts on all three
axes, nonfinite real fills, widening, cancellation, demand budgets, opaque
source demand and existing integer/selection regressions. The full default
Euler 742 golden test passed on both hosts (5.61 and 17.12 seconds under the
test runner). TypeScript build passed. Exhaustive audits and the full suite
were not run.

From the repository root after building:

```sh
EXPECTED=18397727 node benchmarks/euler742.mjs
RANK_SOURCE=benchmarks/fixtures/euler742-original.ra \
  EXPECTED=18397727 node benchmarks/euler742.mjs
DIAGNOSTICS=1 PROFILE=/tmp/euler742.cpuprofile \
  node benchmarks/euler742.mjs 200 20 400
```

Focused tests, from `packages/interpreter`:

```sh
node scripts/test.mjs test/euler742.test.ts \
  test/int64-extrema.test.ts test/shift-storage.test.ts \
  test/tensor-shift.test.ts test/compact-integer-kernels.test.ts \
  test/dense-integer-kernels.test.ts \
  test/wide-integer-arithmetic.test.ts \
  test/stored-integer-selection.test.ts
node scripts/test.mjs test/full-scale-demos.test.ts -t 742
```

The issue's NumPy 0.6-second figure was not reproduced. No parity claim is
made against a different runtime or unmeasured NumPy implementation.
