# Euler 103 and 104: native boolean cells and ranked equality

Baseline: `eb3c46ba`. Default inputs and golden answers are preserved:
103 returns `20313839404245` with sum 255; 104 returns 329468 at limit 400000.

## Changes

The unchanged Euler 103 search already executes as one compiled BigInt loop.
Its algorithm and main source are unchanged. Both former full-size fixture runs
are consolidated into one run, retaining every distinct assertion.

Euler 104's Fibonacci recurrence already executes as one Number loop. The
expensive part was consuming `(ESort equal Want) all axis 1`: each short cell
lowered the native tensor graph again, constructed guards and rebound a kernel.

The tensor compiler now accepts a contiguous range for native `any`/`all`.
The axis consumer prepares one graph on its first demand and reuses its guarded
kernel across trailing cells. Each call visits only the requested cell and still
short-circuits. This reuses the existing IR, operator guards and emitter; it does
not complete the whole comparison mask before its consumer runs. Noncontiguous
axes, ranked producers and unsupported host readers keep their existing path.
Existing shape, revision, native implementation and inspection guards remain.

The demo now expresses row equality directly:

```rank
Good' = ESort Want equal rank 1
Heads' = LSort Want equal rank 1
```

Rank 1 selects each vector cell. Rank 2 would select the whole matrix. Trusted
stored scalar arrays now compare cells directly through their checked readers,
without allocating a separate array view for each compared row. This also serves
higher cell ranks and broadcast frames. Lazy/host inputs, nested values and
explicit axis routing retain ordinary comparison. Mixed numeric equality stays
exact and boolean/numeric comparisons retain their error.

The 104 fixture retains one complete default run with its output, statement-index
and candidate assertions. The two leading-digit checks use their own small
logarithm calculation. No input, execution lane, exclusion or deadline changed.

## Measurement

Apple M5 / Node v24.15.0, medians of three samples per case/version:

| Euler | Version | Workload | Time, s | Peak RSS, MiB |
| --- | --- | --- | ---: | ---: |
| 103 | before | main | 0.250 | 177.3 |
| 103 | before | fixture | 0.394 | 181.4 |
| 103 | after | main | 0.253 | 175.2 |
| 103 | after | fixture | 0.267 | 177.5 |
| 104 | before | main | 2.664 | 545.1 |
| 104 | before | fixture | 10.791 | 602.1 |
| 104 | compiler | main | 1.019 | 405.6 |
| 104 | compiler | fixture | 3.967 | 582.1 |
| 104 | rank | main | 0.875 | 400.8 |
| 104 | rank | fixture | 3.368 | 576.4 |
| 104 | after | main | 0.875 | 405.4 |
| 104 | after | fixture | 0.912 | 413.7 |

The unchanged 104 source improves about 2.6x from the runtime change alone.
The final main is about 3.0x faster than baseline. Its fixture improves about
11.8x, including consolidation of four full runs into one. Euler 103's main is
unchanged within measurement variation; its fixture improves about 1.5x.

Separate diagnostics of original 104 still show **178160 kernel executions**:
rows are recomputed when observed. The updated runtime prepares only **two**
native graphs (one for `Good`, one for `Heads`) rather than rebuilding a graph
for each cell execution. The final ranked source uses the direct stored-cell
comparison and executes no tensor kernels for these comparisons. Both variants
retain the compiled recurrence and 443990 unpacked cells from the digit/sort
pipeline.

[Raw measurements and separate diagnostics](baselines/2026-10-26-euler103-104-native-cells.json).
Measurements run
serially in fresh Node processes, with parsing and complete execution timed.
Independent validation runs after both the execution timer and peak RSS sample.
Before and after order reverses between samples; diagnostics run separately.

The harness distinguishes runtime changes on the original main and repeated
fixtures (`compiler`), the compact ranked main with the original repeated fixture
(`rank`), and the final source/fixtures (`after`). Original workloads are retained
under `benchmarks/fixtures/euler103-repeated_test.ra`, `euler104-axis.ra` and
`euler104-repeated_test.ra`.

Every timed main validates its result independently. For 103 this checks all 128
subset sums for uniqueness and all three cardinality inequalities. For 104 a
scalar recurrence checks every one of the 400000 trailing values, the complete
candidate vector, and the first accepted index. Every timed fixture checks all
embedded test results and the expected number of tests.

Reproduce after building:

```sh
node benchmarks/euler-special-subset-fibonacci.mjs --samples=3
node benchmarks/euler-special-subset-fibonacci.mjs --samples=3 --baseline-runtime=/path/to/before/out/index.js
node benchmarks/euler-special-subset-fibonacci.mjs --samples=1 --versions=compiler,after --cases=main --diagnostics=true
```

Peak RSS is the whole-process high-water mark, including temporary allocation and
GC; it is not retained array memory. Historical concurrent issue inventory times
are not directly comparable with these measurements.

A separate three-sample Euler 093 main control changes from 1.108 to 1.119 s
(about +1%; ranges 1.108–1.111 s and 1.116–1.124 s). Its independent oracle checks
all 385 reachable-value sets. No speed improvement is claimed for that workload.
[Control samples](baselines/2026-10-26-euler103-104-euler093-control.json).

## Verification and limits

Build and interpreter test typecheck, semantic boundary checks and application
form checks pass. All 8403 tests in 369 ordinary interpreter files pass; this run
excludes the exhaustive type/differential corpora and Nurikabe. The four Euler
main/fixture files also pass their scoped type and reference/compiled differential
audits. New native-axis tests cover graph reuse, empty cells/frames, broadcasts,
multiple/noncontiguous axes, host read order, unused plans, division failure
boundaries and completed snapshots. Ranked comparison tests cover matrix cells,
broadcasts, mismatched cell shapes, exact mixed numeric equality and boolean errors.

Axis execution still invokes a kernel per consumed row. This change removes
repeated graph preparation rather than caching row results. The original 104
pipeline's repeated mask observations and two typed buffer unpacks remain; no
implicit result memoization was added. The search and Fibonacci algorithms were
not replaced.
