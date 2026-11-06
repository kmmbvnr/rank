# Euler 748: compact GCD and early candidate filtering

Issue: https://github.com/kmmbvnr/rank/issues/549

Limit=10^16, Digits=1000000000 and the full answer `276402862` are unchanged.
The Pythagorean/Gaussian parameterization, radius bound, two transformed
solutions, primitive tests, duplicate suppression and final coordinate bounds
are unchanged. The implementation applies the existing predicates earlier.
Rows changes from 500 to 128 to reduce temporary working sets.

## Full-input measurements

Baseline: main `8bb06005`, with original source frozen in
`fixtures/euler748-original.ra`. Node v24.15.0; Apple M5 arm64 macOS and Intel
i7-10750H x64 Linux, normal CPU affinity. One baseline and three serial final
fresh-process runs per host. Other load and frequency were not controlled;
baseline variance was not measured. End-to-end times include parsing and
execution. CPU times are separately recorded in raw JSON.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 33.92 | 9.07 / 9.26 / 9.23 | 3.67x | 1369.78 | 930.33 |
| Intel | 73.73 | 19.05 / 17.95 / 17.51 | 4.11x | 1325.95 | 862.37 |

Every full run returned the same answer. Median peak RSS fell by 32.1% on Mac
and 35.0% on Intel. Every final peak was below its host's baseline. RSS is the
whole process high-water mark, not only live array memory or allocation volume.
These single-baseline ratios do not establish stable performance distributions.
The issue's older 68-second figure is not used in place of measured baselines.

Primary data and derived medians are in `results/euler748/`. Earlier trials
are retained separately in `exploration.jsonl`, with original filenames and
complete raw results; they are not pooled into the final series.

## Interpreter first

At Limit=10^15, Rows=32, the original profile identified `mapStoredInt32Binary`
as the largest named self-sampling function (2858 samples). Generic broadcast
addressing, operand expansion, arithmetic maps and temporary assembly also
contributed. Short instrumented profiles are diagnostic, not precise attribution
of full-input time. Summaries are retained in `profile-summary.json`.

The existing exact GCD helper now has compact stored-array kernels for equal
shapes/scalars and broadcast rows. Outputs are written directly into Int32
storage. Broadcast addresses are calculated once per row rather than per cell;
short boxed row constants use the existing checked conversion. This avoids the
generic Float64 scratch pass and subsequent packing for ordinary Int32 GCDs.

The Euclidean algorithm itself is unchanged. Signed operands and zero remain
exact. A GCD of 2^31 does not fit Int32: the private compact output is discarded
and the previous widening path runs. Wider inputs, unsupported views, host
polling and other unsupported cases retain their old paths. Source validation,
input independence, cancellation checkpoints and demand budgets remain.

This is a general interpreter change, but it is a modest part of this task's
full-program gain. With the original source and Rows=500, single runtime-only
runs measured 31.26 seconds on Mac and 72.66 on Intel, versus 33.92 and 73.73.
After early filtering shrinks the GCD inputs, its contribution becomes smaller:
the final Rank source on the baseline Mac runtime measured 9.27 seconds, close
to the final median of 9.23. Do not attribute the entire 3.67x/4.11x result to
the new kernel.

## Rank solution and memory

Originally, the full rectangular table continued through every transformed
coordinate, GCD, bound check and sum even where `Plain` was false. Multiplying
by a zero keep-mask at the end discarded those candidates only after that work.

The final source first computes the same radius, ordering and parity mask.
It reshapes that mask to a vector and uses the existing `indices` operation.
For each true position, division/remainder by Side reconstruct its original
row and column; First restores the row's global offset. The existing coprime
test then filters those two coordinate vectors before transformed coordinates
are computed. The later conditions no longer repeat Plain, because every
remaining pair already passed it.

This reorders the existing tests and changes intermediate table shapes. It is
a Rank-solution optimization, separate from the interpreter kernel. No new
number-theoretic identity, reduced search bound or solution-generation method
is introduced. Row-major order and all accepted primitive solutions remain.
The independent equation oracle checks this beyond the transformed-pair model.

At defaults, Top=7913. Both programs examine the same 62623482 rectangular
positions for the geometric mask. Rows=500 partitions them into 16 blocks;
Rows=128 uses 62 smaller blocks. The default Rows change trades more block
setup for a smaller working set. Users can still override Rows.

The radius is recomputed on surviving one-dimensional pairs. Later arithmetic
reads that compact vector and needs no second gather of the rectangular radius.
Only the cheap geometric stages remain rectangular; expensive stages operate
on selected vectors. The source still has one loop and uses existing array
operations.

## Controls and exploratory choices

`experiments/euler748-gcd.mjs` measures 1048576 cells with setup and complete
BigInt verification outside the timed region. RSS is captured before verification.
Each entry is the median of three paired baseline/final fresh processes.

| Kernel | Mac baseline / final ms | Intel baseline / final ms |
| --- | ---: | ---: |
| Equal-shape integer GCD | 74.70 / 62.26 | 128.34 / 111.04 |
| Broadcast integer GCD | 88.49 / 60.21 | 164.28 / 114.46 |
| Addition control | 3.36 / 3.28 | 5.85 / 5.51 |

These demonstrate the general kernel improvement without substituting isolated
ratios for the full-program comparison.

A first Rank trial filtered after the rectangular GCD; it measured 8.68 seconds
at Rows=500. The earlier-filtering version measured 9.71 seconds at Rows=500,
9.46 at Rows=64 and 8.14 at Rows=128. Those are single exploratory samples,
not controlled marginal-effect measurements; the selected version was measured
again in the primary three-run series, whose slower median is reported above.
The other source trial and row-size samples remain in the repository.

## Verification and reproduction

TypeScript build passed. On both Mac and Intel, 79 focused tests and the full
default Euler 748 golden test passed. The golden took 12.26 and 24.68 seconds
under the runner, separately from primary benchmark timings. Full suites and
exhaustive audits were not run.

The small oracle directly enumerates x and y in
`z^2*(x^2+y^2)=13*x^2*y^2`, uses a map of exact integer squares and tests global
primitivity, then sums x+y+z. It does not use the Pythagorean/Gaussian
parameterization. Cases include the smallest valid solution, empty results,
five row sizes, exact block boundaries and both compilation modes. Existing
Limit=100, 1000 and 100000 examples remain 124, 1470 and 2340084; multiple
output moduli are checked. Runtime tests cover signed/zero GCDs, the 2^31
widening case, high-rank broadcasting, short boxed rows, reversed views,
arbitrary precision, source independence, cancellation and budgets.

From the repository root after building:

```sh
EXPECTED=276402862 node benchmarks/euler748.mjs
RANK_SOURCE=benchmarks/fixtures/euler748-original.ra \
  EXPECTED=276402862 node benchmarks/euler748.mjs 10000000000000000 500
DIAGNOSTICS=1 PROFILE=/tmp/euler748.cpuprofile \
  node benchmarks/euler748.mjs 1000000000000000 128
RANK_ROOT=/path/to/baseline \
  node benchmarks/experiments/euler748-gcd.mjs broadcast
```

Focused tests, from `packages/interpreter`:

```sh
node scripts/test.mjs test/compact-gcd.test.ts test/euler748.test.ts \
  test/compact-integer-kernels.test.ts test/segmented-integer-kernels.test.ts \
  test/observed-integer-comparison.test.ts
node scripts/test.mjs test/full-scale-demos.test.ts -t 748
```
