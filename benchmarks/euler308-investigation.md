# Euler 308: prime-generating automaton

The next unfinished task in issue #447 at investigation time was
`euler/308_automaton.ra`. Historical audit times were 47.6 s reference / 2.7 s
compiled. Those concurrent observations are not a before baseline.

The program already avoids simulating FRACTRAN's 1,539,669,807,660,924 steps.
It computes transitions through the 10001st prime, 104743, and groups equal
integer quotients in `floors`. The complete second loop, including the helper,
already uses one Number loop; no overflow was reported. Replacing that algorithm
is not the first priority.

## Delivered implementation

The demo now selects the existing library factor sieve through its supported
limit, 1048575, and retains the original ordinary sieve above that bound.
The default Target=10001, grouped-floor algorithm and exact answer are unchanged.
The general singleton numeric-slice repair described below is included too;
it benefits both reference and compiled execution without changing compiler
admission thresholds.

Final production measurements: three serial fresh processes per case, rotating
order, same baseline snapshot as the runtime isolation experiment. See
`baselines/2026-11-01-euler308-delivery.json` and
`experiments/euler308-delivery-samples.mjs` (prepare its baseline by running
`euler308-runtime-samples.mjs` first, after the TypeScript build).

| Full default | Wall median, s | CPU median, s | Peak RSS median, MiB |
| --- | ---: | ---: | ---: |
| Original source / baseline / compiled | 0.787 | 1.739 | 429.0 |
| Production source / repaired runtime / compiled | **0.204** | **0.346** | **180.5** |
| Original source / baseline / reference | 7.729 | 9.148 | 577.5 |
| Production source / repaired runtime / reference | 4.987 | 5.749 | 431.2 |

This series shows 3.85x less compiled wall time and 58% lower compiled peak RSS.
Compiled wall ranges are 0.754–0.898 s before and 0.195–0.241 s after. Reference
ranges overlap: 5.498–7.766 s before and 4.959–7.054 s after. The host remains
busy; the reference medians are observations, not a stable speedup guarantee.
Earlier series below isolate the source and runtime effects and remain intact.

## Unexpected whole-buffer copies

The hand-written smallest-prime-factor sieve binds `Old = Spf Ix` and uses a
lazy filter of Old before writing Spf. Materialized arithmetic index vectors
retain affine addressing. Once P exceeds Top/2, Ix contains one element and
its stride is normalized to one. Ordinary binding completes this selection
as a contiguous shared numeric buffer view.

Protecting that single old element on an overlapping Spf write then copies
all 104744 source cells. There are 4649 such copies: **486954856 cells**, about
1.81 GiB of cumulative Int32 copy traffic. This is not peak memory. The other
strided selections already complete into independent selected-cell buffers.

A CPU profile of the original compiled program includes privateArrayCopy and
GC among its largest sampled costs. The snapshot value semantics are correct;
the physical ownership choice is wasteful.

## Local general runtime repair

`sliceStoredArray` now gives a one-element numeric selection its own typed
buffer. It keeps its full Rank shape, scalar-kind evidence, declaration and
value semantics. Integer32, integer64 and real storage all use this rule,
including selections with shape [1,1]. There is no workload-specific test,
new compiler admission limit, or configurable cutoff. Larger contiguous
selections retain the existing shared-buffer path.

All 4649 whole-source copies disappear in the unchanged full Euler program,
in both engines. This repair does not remove copies needed to preserve
ordinary whole-value aliases or larger overlapping shared slices. A general
scheme that detaches arbitrary retained slices on source mutation remains
possible but would need to handle nested views and external observations.

## Controlled measurements

Apple M5, Node v24.15.0. Three serial fresh processes per case, rotating order.
Imports/startup excluded; parsing and execution included. Process CPU is
user + system time including runtime threads. The baseline restores only
`runtime/owned-array.ts` from b6bdadaf; all other runtime modules are identical.
Full answer is checked in every sample. See
`baselines/2026-11-01-euler308-runtime.json` and
`experiments/euler308-runtime-samples.mjs`.

| Full case | Wall median, s | CPU median, s | Peak RSS median, MiB |
| --- | ---: | ---: | ---: |
| Original source / baseline / compiled | 1.206 | 2.654 | 447.4 |
| Original source / singleton repair / compiled | 1.220 | 1.699 | 375.4 |
| Library sieve / singleton repair / compiled | 0.303 | 0.460 | 179.3 |
| Original source / baseline / reference | 11.849 | 13.787 | 606.3 |
| Original source / singleton repair / reference | 9.754 | 11.608 | 486.5 |
| Library sieve / singleton repair / reference | 11.185 | 11.952 | 424.9 |

The host was busy: load grew from about 2.5 to above 6 during investigation.
Runtime-only compiled wall ranges overlap (1.081–1.352 s baseline,
0.856–1.479 s repaired); reference ranges overlap too (7.144–13.022 s versus
8.182–11.311 s). **No stable runtime-only wall speedup is established.**
Compiled CPU median falls about 36%, and peak RSS about 16%; reference CPU
falls about 16%, RSS about 20%. The structural result, zero whole-buffer copies,
is independent of scheduling noise.

An earlier source-only series is retained separately in
`baselines/2026-11-01-euler308-samples.json`: compiled original 0.772 s,
inline-selection rewrite 0.465 s, library sieve 0.205 s; reference original
7.835 s, library sieve 4.695 s. Do not combine series or claim a reproducible
reference speedup from the library rewrite: its later reference samples vary
from 6.234 to 11.426 s.

## Library option and remaining interpreter work

`Top factorsieve` replaces the entire hand-written sieve using an existing
library operation. The compiled full default is about four times faster than
the unchanged source on the repaired runtime in the runtime isolation series.
The delivered production variant adds an explicit fallback above the library
bound, and its final measurements are shown above.

The library currently accepts limits through 1048575, whereas the existing
program does not declare that bound on Target. The production rewrite therefore
retains the ordinary-sieve fallback for larger Top, preserving the accepted
input range. Default Top=104743 fits the existing library limit.

The library variant still spends substantial time in reference evaluation of
the second loop. A separate reference CPU profile places expression evaluation,
frame lookup, assignments, application dispatch and block scheduling among
the largest sampled costs. There is no evidence that the grouped-floor
algorithm itself explains the reference/compiled gap. A general interpreter
execution improvement would need its own controlled experiment; no further
compiler change is claimed here.

## Verification

- TypeScript project build passes.
- 217 focused tests pass across eight files, including 14 new singleton
  tests and existing contiguous-slice, snapshot, bulk-write, typed-array,
  copy-storage, slice-arithmetic and Number-loop coverage in both engines.
- Independent BigInt FRACTRAN simulation produces the first 16 emitted powers
  of two after 215797 direct steps. Original, inline and library variants match
  all 16 answers in both engines. Production and a forced small-bound fallback
  variant also match: 160 independent checks in total.
- Both existing fixture assertions pass in each engine: another four checks.
- Every full benchmark run checks the exact answer **1539669807660924**.
- Both factor tables at the actual library boundary, 1048575 and 1048576,
  match an independent JS sieve at every cell: 2097153 cell comparisons.
- The new ordinary full-scale regression passes and retains the complete
  default answer. Two scoped type checks, two scoped differential checks and
  two scoped name-facts checks pass.
- Semantic boundaries pass (11 tests / 65 owners), as do application-form checks.
- Full suites and exhaustive audits were not started.

Defaults, existing fixture assertions and execution lanes are unchanged.
The issue receives one consolidated results comment and a completed table row.
