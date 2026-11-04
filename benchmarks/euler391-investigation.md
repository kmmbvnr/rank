# Euler 391 delivery and investigation

Euler 391 now uses scalar offsets into two banks of one DP table, retaining
the recurrence and exact answer. The common compact-integer publication path
also bounds its validation/store loops to the span with dirty cells. It still
validates every dirty cell before writing and allocates no extra buffer.

## Delivered results

| Full compiled | Mac seconds | Mac RSS MiB | Intel seconds | Intel RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 25.524 | 338.5 | 64.842 | 321.3 |
| Delivered demo + runtime | **0.460** | **190.8** | **0.987** | **188.0** |

Mac and delivered Intel values are three-process medians; original Intel is
one sample. Final measurements and checks were repeated after integrating
main ef8607d8 (shared producer-fold changes, outside this scalar recurrence).
The delivered layout also hoists bank additions out of the cell
loop. On the original program alone, the runtime change gives 9.927 s /
429 MiB on Mac and 41.087 s / 363 MiB on Intel (single controls). That isolated
change improves CPU time but does not demonstrate a lower RSS; the combined
delivery reduces both time and memory substantially.

Full delivered reference completes with the same answer in **86.049 s /
389.8 MiB** (one Mac sample). It remains excluded from shared corpus audits
because of that cost; the full compiled default has a focused golden test,
and the expanded fixture remains in both type and differential audits.

Verification on integrated main ef8607d8: 587 focused tests in 11 files on
Mac; 142 focused tests in six files on Intel; two scoped fixture audits;
252 direct comparisons across seven variants and both engines, including an
independent finite-game oracle. Build, test typecheck, semantic boundaries
(65 owners), application forms and whitespace checks pass. Full suites and
exhaustive audits were not run.

`unpack A B = tuple B A` already exchanges bindings without a temporary name.
Both engines preserve outside snapshots after either swapped array is
mutated; two regression cases and documentation now show this. Efficient
compilation of tuple-unpacked array rotation remains follow-up work: this
change does not remove alias guards or add new language syntax.

Raw final evidence: `baselines/2026-11-04-euler391-delivery.json`.
The sections below record the pre-delivery experiments. Their prototype
numbers are controls, not timings of the final source.

The [statement](https://projecteuler.net/problem=391) asks for the sum of
cubes of the maximum winning opening move for n=1..1000. The existing
recurrence gives **61029882288**. Every full prototype and the handwritten
JS implementation reproduce this answer.

## Measurements

Mac: Apple M5, Node v24.15.0. Three sequential fresh processes per variant;
medians below include parsing and execution, exclude module imports and
interpreter construction. Peak RSS is whole-process, not retained arrays.
No investigation jobs overlapped on a given host; other machine load was
not controlled. Intel: i7-10750H, Linux x64, same Node; single samples.
The Intel snapshot contains the integrated runtime used for Euler 388
(16e1375e); subsequent tracked changes on current main are ACMP demos.

| Full compiled variant | Mac seconds | Mac RSS MiB | Intel seconds | Intel RSS MiB |
| --- | ---: | ---: | ---: | ---: |
| Original | 25.524 | 338.5 | 64.842 | 321.3 |
| Two banks in one array | 0.596 | 192.0 | 1.340 | 186.6 |
| Original separate arrays, grow rows when needed | 1.288 | 329.8 | 2.835 | 251.8 |

The bank variant retains the recurrence and **99,769,950** cell updates,
but swaps scalar offsets rather than array bindings. It compiles the
whole search as one region, plus initialization, instead of 35,467 loop
regions. It removes all COW copies in diagnostics. The outer search still
uses the publishing backend because its destination exceeds the private
Number copy-probe cap. Research-only admission of Number yielded 0.566 s
and 202 MiB, no convincing gain over the normal backend; do not change the
cap for this case.

The original compiled run has 16,733 COW copies, 16,783,232,466 copied cells:
62.52 GiB COW plus 66.26 GiB Number snapshots, about **128.8 GiB cumulative**.
This is copying traffic, not peak or retained memory. CPU sampling also
shows `writeInteger32Cells`, which scans the whole dirty bitmap twice.

The growing separate-array variant needs only 26 rows per table instead
of 1002 for this input, without assuming 26 is a universal bound. It grows
when S reaches capacity. It retains the alias compilation rejection and
repeated publication, so it is slower than scalar bank offsets. A growing
single-array bank prototype also passes, but took 1.808 s / 302 MiB on Mac.
These are performance experiments, not a proposed style for the final demo.

## General compiler/runtime opportunities

1. `jit/integer-loop.ts` rejects writable aliases and rebound inputs.
   `Tmp = A; A = B; B = Tmp` hits `mutable-array-alias` for the outer loops.
   Simply removing the checks is unsafe: ordinary `=` snapshots and
   aliases retained at a break, error, or final publication must remain
   independent. Supporting array rotation needs ownership and lifetime
   tracking, including observable temporary bindings. The bank layout is
   a safe demo-level workaround using current semantics.
2. `runtime/owned-array.ts::writeInteger32Cells` validates and commits by
   scanning the entire dirty bitmap. A research loader narrows both JS
   loops to the first/last dirty position, leaving snapshots and COW
   unchanged. Original program: Mac **25.5 -> 10.1 s**, Intel
   **64.8 -> 40.2 s**. Full answers and 216 small comparisons pass with the
   hook. Single control samples; Mac RSS rose to 462 MiB (Intel350 MiB),
   so this is evidence of a CPU opportunity, not a demonstrated memory win.
   A production change should also consider sparse dirty runs/indices and
   verify widening, partial errors, cancellation and replay with focused
   storage tests. No blanket buffer publication or threshold change.
3. Array expression fusion needs work. Replacing the inner scalar loop
   with gather, add, masked zeroing and gather/scatter is correct, but the
   bank prototype costs **11.87 s / 1113 MiB compiled**, **24.57 s / 430 MiB
   reference**. Diagnostics: 843,797 typed publications / 499,845,785 cells,
   171,479 tensor kernels, many output-shape/operator guard fallbacks;
   CPU sampling includes array readers, operator dispatch and GC.
   The `X min Step mod Step` alternative is equivalent for these
   nonnegative values but slower (17.37 s / 1135 MiB Mac compiled;
   49.42 s / 493 MiB Intel). A lazy plan reading Data correctly prohibits
   mutating Data; do not weaken the explicit plan borrowing rule.

## Reference execution and validation

Original reference at Limit300: **5.262 s / 320 MiB**, including 3862 COW
copies / 1.31 GiB. The bank/vector prototype: **2.279 s / 466 MiB** at300,
24.57 s at1000. Original full reference was not rerun; the issue's >120 s
entry is historical, not a newly verified timing. Reference still pays
per-cell dispatch in scalar loops; the published compiled speedup is not
claimed for reference execution.

`euler391-verify.mjs` performs **216 comparisons** across six programs and
both execution modes. It independently enumerates legal game positions
for each n=1..14, stopping at the first gap larger than n, then solves the
finite impartial game backwards. It compares each winning opening move,
not just the sum. Boundary Limit0 and statement checks Limit2,7,20 are
also verified. The same 216 comparisons pass under the dirty-span hook.
Full input equality is checked across Rank prototypes and handwritten JS;
there is no independent exhaustive full-game oracle at n1000.

Handwritten JS executes the same table recurrence in one sample around
0.105 s / 50 MiB, excluding language parsing and Rank semantic checks.
It observes 17,733 stages, maximum S25, and 16,733 swaps. This is a useful
comparison for engine overhead, not a promise that Rank can reach that
number without additional work.

## Selected implementation and remaining work

The delivery retains the recurrence and removes whole-array rotations using
scalar bank offsets. Bounded dirty publication is implemented as a general
runtime improvement, with focused correctness and cross-platform controls.
If keeping the inner step in array notation, improve its gather/map/store
fusion before choosing that version: current prototypes lose heavily in
both speed and allocation. Do not replace the existing alias guard with
an unchecked optimization.

## Reproduction

```sh
node benchmarks/euler391-investigation.mjs 1000 compiled
node benchmarks/euler391-investigation.mjs 1000 compiled \
  benchmarks/experiments/euler391-original.ra
node benchmarks/experiments/euler391-verify.mjs
```

The dirty-span research loader targets the original pre-repair emitted JS.
It intentionally refuses the delivered runtime; use the production helper now.
Raw samples and diagnostics: `baselines/2026-11-04-euler391-investigation.json`.
No complete test suite or exhaustive audit was run. Research programs and
focused delivery tests were checked through both engines. GitHub results are
reported in one consolidated comment with a compact completion row.
