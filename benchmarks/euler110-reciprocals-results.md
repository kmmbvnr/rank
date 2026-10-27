# Euler 110: bounded exponent tables and deferred intermediates

Status: implemented in Euler 110 and Euler 108. Both demos bound the exponent
table by `Top max`, stop when no candidates remain, and defer `Big`/`Next`.
The interpreter, fixture assertions, defaults and execution exclusions are
unchanged. Baseline: `724ccc0e`, Apple M5 / Node v24.15.0.

The issue #447 note that the default exceeds 30 seconds is historical. Even
before this demo change, the current interpreter returned the unchanged golden
answer `9350130049860600` in about 2.83 seconds compiled and 3.53 seconds reference
in the initial series. That historical timeout no longer reproduced on this host.

## Initial controlled investigation

Three serial fresh processes per version; forward/reverse/forward variant order.
No builds, tests or other benchmark workers ran concurrently. The same worker
uses a 2048 MiB heap limit. Times include parsing, execution and output callbacks,
exclude imports; diagnostics, tracing and profiling ran separately. RSS is median
whole-process peak, not retained table storage. All 15 timed runs check the full
answer. No Intel measurements were made in this investigation.

| Variant | Median time | Median peak RSS |
| --- | ---: | ---: |
| Original, compilation enabled | 2826.15 ms | 640.17 MiB |
| Original, reference | 3532.06 ms | 622.94 MiB |
| Bound table width, compilation enabled | 419.40 ms | 209.27 MiB |
| Original width, deferred Big/Next | 2736.95 ms | 306.50 MiB |
| Bound width + deferred Big/Next | 408.55 ms | 195.61 MiB |

Bounding width alone gives **6.74x** speedup; the combined variant gives **6.92x**
and roughly **69% lower peak process RSS**. The small difference between the two
bounded variants is not established as a repeatable additional speedup.
Deferred bindings alone mainly save memory in these samples.

## Why it is slow

The program expands every surviving candidate into 60 exponent columns for
every prime. At its widest level it retains 10,136 rows. A complete source trace
contains 48,603 input rows across all levels: 2,916,180 row/column combinations,
before repeated expressions and mask passes. Most columns are rejected by the
non-increasing exponent bound already stored in `Top`.

Original diagnostics record 11,764,924 computed cells (1,638,319 in the combined
prototype), zero compiled scalar loops and 12 compiled tensor consumers. The entire search does not compile as one
region; the ordinary loop traverses tensor operations. The CPU profile's largest
self sample is mask selection (16.2%), followed by array reads (6.4%), GC (5.7%)
and outer-product iteration (4.4%). These are sampled self times, not total
inclusive costs or measured speedup ceilings.

The compiler helps already, but only about 1.25x for this source. Runtime
opportunities remain in mask/consumer composition and exact outer products.
Deferred assignments are rejected as immediate tensor completion targets by
`tensor-kernel.ts`; that is appropriate for unused deferred stages. Removing that
check would change evaluation timing. The useful direction is lowering recipes
at their actual consumers, while preserving ordinary `=` completion boundaries,
mask validation, error ordering, interruption and exact integers. The final
answer itself exceeds Number's safe-integer range.

## Prototype and validation

The bounded variant retains the same breadth-first array algorithm. At each
prime it stops if `N` is empty, sets `Exp = 1 to (Top max) array`, and reshapes
`Cols` to that width. Columns above every current row's cap cannot pass `Cap`,
so omitting them cannot remove a viable candidate. The initial bound remains 60.
It changes temporary arrays and loop-local state; no full-variable equivalence
with the original is claimed. The combined version additionally uses `Big'` and
`Next'`, explicitly opting into recomputation instead of materializing those
two tables at their assignments.

An independent exact BigInt depth-first search enumerates non-increasing prime
exponents, starts with a valid primorial incumbent, and prunes products at that
incumbent. For targets 1, 2, 3, 4, 5, 10, 20, 50, 100, 1000, 10000 and 4000000,
bounded, bounded+deferred and reference-bounded Rank executions all match it:
**36 comparisons passed**. This is independent of tensor/mask execution, but
uses the same mathematical prime-exponent characterization. It is not an
exhaustive domain proof. These initial checks used isolated source variants;
post-implementation verification is recorded below.

Reproduce against an archived baseline after `npx tsc -b tsconfig.build.json`
(the default worker now runs the implemented demo):

```sh
git show 724ccc0e:demos/euler/110_reciprocals2.ra > /tmp/rank110-before.ra
node benchmarks/euler110-reciprocals.mjs 4000000 --source=/tmp/rank110-before.ra
node benchmarks/euler110-reciprocals.mjs 4000000 --source=/tmp/rank110-before.ra --trim
node benchmarks/euler110-reciprocals.mjs 4000000 --source=/tmp/rank110-before.ra --lazy
node benchmarks/euler110-reciprocals.mjs 4000000
node benchmarks/euler110-reciprocals.mjs 4000000 --reference
node benchmarks/euler110-reciprocals.mjs 4000000 --diag
```

[Raw samples, diagnostics, trace, profile summary and oracle checks](baselines/2026-10-27-euler110-investigation.json).

## Implemented source: final paired measurements

A separate three-sample series compares the exact final demo files with their
`724ccc0e` sources using the same current interpreter. Cases/versions run serially
in alternating forward/reverse order, with a 2048 MiB heap limit. This harness
includes interpreter construction, parsing, execution and output callbacks;
imports and golden assertions are outside the interval. All 24 golden answers
passed. Tests and builds ran before this timing series.

| Case / engine | Before | After | Speedup | Peak RSS before → after |
| --- | ---: | ---: | ---: | ---: |
| Euler 110, compiled | 5463.45 ms | 784.96 ms | 6.96x | 534.56 → 199.03 MiB |
| Euler 110, reference | 6918.84 ms | 1103.53 ms | 6.27x | 630.69 → 203.34 MiB |
| Euler 108, compiled | 389.71 ms | 289.37 ms | 1.35x | 186.50 → 177.98 MiB |
| Euler 108, reference | 411.81 ms | 303.78 ms | 1.36x | 186.52 → 175.44 MiB |

Absolute times differ substantially from the initial series; the cause of that
host timing change was not isolated. Compare before/after within each series,
not the initial baseline with the final candidate. Both series support the
roughly sevenfold full Euler 110 improvement. All samples are retained.

Post-implementation checks passed: TypeScript build, interpreter test typecheck,
semantic boundaries (65 owners), application-form checks, and 46 new focused
checks. The focused checks enumerate every integer up to the first solution for
ten small targets, without the ordered prime-exponent search, for both demos in
both engines. They also execute every original assertion in the three existing
fixtures in both engines, including full Euler 110 and its answer above 2^53.
Six scoped type/differential audit cases pass. The historical exclusion means
those corpus audits select Euler 108 main/fixture and the smaller Euler 110
fixture; full Euler 110 is instead checked explicitly by the focused suite and
fresh-process measurements. No full ordinary suite or Intel run was performed
for this demo-only change.

[Final paired samples and verification](baselines/2026-10-27-euler110-delivery.json).

General mask/consumer fusion remains a separate interpreter follow-up, not part
of the delivered demo optimization.
