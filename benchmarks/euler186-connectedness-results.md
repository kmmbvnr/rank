# Euler 186: direct packed reads and streaming experiments

Baseline: `1d4edd41124b7582fb8e6d23cf95c921eaa34ca6`. Apple M5, Node v24.15.0.
The runtime change reads owned stable Int32 cells directly instead of through
the generic items Proxy. Demo, fixture, algorithm, default inputs, golden
assertions, execution exclusions and deadlines are unchanged.

## Finding

The historical exclusion is not evidence that the current compiled program is
slow. The complete default already takes about **0.252 s**. The large reference
cost is ordinary interpreter execution, rather than a poor connectivity
algorithm. The implemented general packed-read improvement targets that
reference overhead. Streaming variants are measured experiments, not demo
changes.

The main returns **2325629**. Both fixture tests pass, including the unchanged
full default and generator values `T 9 = 106973`, `T 99 = 586613`.

## Initial investigation measurements

Three serial fresh workers per compiled/native case, alternating case order.
No concurrent tests, builds or profilers. Worker time includes interpreter
construction, parsing, complete execution, validation and disposal; module
loading precedes the timer. Native workers use the same import path, so their
whole-process RSS also includes the imported Rank runtime. These are current
implementation comparisons, not before/after optimization results.

| Workload | Median time | Median peak RSS |
| --- | ---: | ---: |
| Rank main, compiled | 251.890 ms | 239.11 MiB |
| Rank fixture, compiled | 284.168 ms | 257.81 MiB |
| Direct JS, same algorithm and full generator | 46.693 ms | 131.89 MiB |

Separate unprofiled reference validations, one fresh worker each: main
**35.174 s**, fixture **36.736 s**; both pass. These are single observations,
not repeated reference performance estimates. The main reference observation
is about 140 times the compiled median.

The roughly **5.4x** compiled/native difference includes Rank setup and runtime
contracts; it is not a measurement of scalar arithmetic alone. No memory-saving
implementation is claimed from the RSS comparison.

Three separate compiled phase probes give generation/setup medians of
157.102 ms and network initialization/search medians of 96.663 ms. Splitting
execution into two `execute()` calls can affect preparation and liveness, so
these probes explain phases rather than replacing whole-program timings.
Direct JS spends about 6.74 ms generating and 39.81 ms initializing/searching.

A separate CPU-profiled reference phase probe took 32.110 s: 6.443 s in
generation/setup and 25.666 s in network initialization/search. This is a
single instrumented diagnostic, not a benchmark median. Unprofiled full main
and fixture reference validations are recorded separately in the raw results.

## Why

The existing algorithm uses union by size and path halving. For C calls and
U users, it needs O(C) generation and approximately O(C alpha(U)) union-find
work, with O(C + U) storage. It already avoids rescanning the whole graph.
The default processes 2325632 pairs, including three self calls, before reaching
the target. All 6000000 generator terms are computed beforehand; 1348736 terms
are consequently unused at the default early exit.

Compiled diagnostics report **two compiled Number loops**, no overflows, no
compiler rejections, no ordinary computed cells and no CoW copies. The two
loop regions cover the recurrence and the entire network search, including
nested root walks. There is no missing loop lowering to repair here.

Reference self samples concentrate in `readArrayItem`, expression evaluation,
frame lookup, assignment, selection and statement execution. Every root walk
therefore incurs ordinary value dispatch and access checks repeatedly. The
compiled profile instead concentrates in generated loop code, with visible
`writeInteger32Cells` publication and numeric-loop setup. The Number backend
uses private destination buffers, dirty masks and checked publication to retain
exact replay/error semantics; the direct JS implementation does not implement
those contracts. Profiles identify these costs but do not isolate how much
each contract contributes to the 5.4x ratio.

## Implemented change

`readArrayItem` already has trusted owned storage and a numeric offset. For
stable Int32 storage it now reads the typed cell directly and converts it to
an exact Rank BigInt, avoiding numeric-key/string-key conversion in the
`integer32Items` Proxy. Other storage keeps its previous path. The validity
check still precedes reading; undefined/invalid offsets retain their existing
fallback, and unstable storage uses the current public reader/items.

Nothing is cached: widening to Int64/arbitrary precision, public mutations,
missing-value writes, host-installed readers and foreign reader exceptions
remain visible. New tests cover those contracts and absence of typed unpacks.

Controlled before/after records are in
`baselines/2026-10-27-euler186-comparison-{compiled,reference}.json`. They use
three serial fresh workers per case/version with alternating version order;
profiles, builds and tests ran separately. Hashes identify both array-read
implementations. The compiled main medians are 263.314 -> 256.164 ms; fixture
medians are 287.919 -> 286.728 ms. Ranges overlap, so these do not establish a
compiled speedup. The change targets ordinary reads in the reference engine.

| Reference workload | Before median | After median | Time reduction | Before peak RSS median | After peak RSS median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Main | 36.625 s | 29.650 s | 19.0% | 460.41 MiB | 207.88 MiB |
| Fixture | 37.553 s | 30.009 s | 20.1% | 476.38 MiB | 217.81 MiB |

All six main and six fixture workers pass. Whole-process peak RSS decreases
by 54.8% and 54.3% respectively. These are process peaks, not retained-memory
or allocation-volume measurements. The arrays and their sizes are unchanged.
General reference dispatch overhead remains after this targeted improvement.

Two unchanged full-default compiled controls used the same three-worker,
alternating-version protocol and passed their golden answers:

| Control | Before median | After median |
| --- | ---: | ---: |
| Euler 060 | 2588.863 ms | 2607.195 ms |
| Euler 177 | 1353.841 ms | 1331.756 ms |

Euler 060's final median is 0.7% higher; its sample ranges nearly touch but do
not overlap. Euler 177's ranges overlap. These small control samples do not
establish a universal speedup or absence of performance regressions.

## Measured ring-buffer alternatives

Two experimental Rank sources retain the same union-find and stopping rule:
`fixtures/euler186-ring.ra` uses modular indices and a two-term inner loop;
`fixtures/euler186-ring-cursors.ra` uses two wrapping cursors and no extra
inner loop. The latter updates each consumed cell to the term 55 positions
ahead using the other cursor at offset 31. Both preserve the generated stream.

Three serial fresh-process medians on the final runtime:

| Variant | Time | Peak RSS |
| --- | ---: | ---: |
| Original full array | 258.921 ms | 239.92 MiB |
| Ring, modular indices | 304.730 ms | 189.13 MiB |
| Ring, wrapping cursors | 267.308 ms | 188.42 MiB |
| Direct JS, full array | 48.624 ms | 131.19 MiB |
| Direct JS, modular ring | 49.681 ms | 108.41 MiB |

The cursor ring reduces whole-process peak RSS by about **21.5%**, but is
**3.2% slower** in these samples; the modular Rank ring is about **17.7% slower**.
The six-million-cell integer buffer itself falls from 24,000,000 bytes to
220 bytes, but whole-process RSS also includes runtime, union-find arrays and
private execution buffers. The direct JS ring likewise saves memory without
a timing improvement (2.2% higher median here, with overlapping time ranges).

The full wrapping-cursor ring also passes in reference mode: one separate
fresh-process validation took **34.200 s**, with peak RSS **183.97 MiB**. This
single observation gives no reference speedup over the original final-runtime
main (29.650 s median). The modular ring's full reference input was not timed;
both rings pass the small/reference stream checks.

Neither ring is adopted: they do not improve compiled speed and their `T`
contains only 55 cells of generator state rather than the full observable
stream. The unchanged fixture observes `T 99`, so replacing that state would need a separate
behavior decision. Experimental sources remain under `benchmarks/fixtures`.

## Follow-up choices

Keep the current algorithm for this pass. General reference array access,
expression dispatch and assignment are the primary performance opportunity.
For compiled execution, investigate numeric-region setup/publication and
generated recurrence code with separate controlled experiments before changing
runtime contracts.

## Verification and reproduction

TypeScript build, test typecheck, semantic boundaries (65 owners), application
forms, benchmark syntax and whitespace checks pass. The ordinary interpreter
suite passes **8,917 tests in 395 files**, including six new packed-read tests;
exhaustive type/differential audits and Nurikabe remain separate lanes.

Nine small configurations (80/100/127 users, 1/50/99 percent) match an independent
adjacency-list/BFS connectivity oracle for the original and both Rank ring
variants in both engines: **54 Rank checks**, plus 18 direct-JS checks. The first
2,000 generated terms match the full generator for both Rank rings in both
engines, including wrap boundaries. The oracle shares generator code with the
direct JS implementation; the unchanged Rank fixture independently checks two
specified generator terms. Full main and both original fixture assertions pass
in both engines.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/euler-connectedness.mjs --samples=3 --cases=main,fixture --before-runtime=/path/to/baseline/packages/interpreter/out/index.js
node benchmarks/euler-connectedness.mjs --samples=3 --cases=main,fixture --engine=reference --before-runtime=/path/to/baseline/packages/interpreter/out/index.js
node benchmarks/euler-connectedness.mjs --samples=3 --cases=main,ring,ring-cursors,native,native-ring
node benchmarks/euler-connectedness.mjs --samples=1 --cases=ring-cursors --engine=reference --deadline=120000
node benchmarks/euler-connectedness.mjs --samples=1 --cases=main,fixture --engine=reference
node benchmarks/euler-connectedness.mjs --samples=3 --cases=phases
node benchmarks/euler-connectedness.mjs --worker=main --diagnostics=1
node benchmarks/euler-connectedness.mjs --checks=1
node --expose-gc benchmarks/euler-prime-pairs.mjs --worker=bits --runtime=/path/to/out/index.js
node benchmarks/euler-quadrilaterals.mjs --worker=main --version=final --runtime=/path/to/out/index.js
node --cpu-prof --cpu-prof-dir=/tmp benchmarks/euler-connectedness.mjs --worker=phases --engine=reference
```

Raw measurements: `baselines/2026-10-27-euler186-{compiled,reference,phases,diagnostics,checks,profile-summary}.json`.
Profile summaries retain top self samples; full V8 profiles are temporary local
artifacts. Profile sample counts include imports and use different sampling
intervals, so they must not be compared across engines.

Additional raw records: `baselines/2026-10-27-euler186-{comparison-compiled,comparison-reference,ring-comparison,ring-reference,final-checks,final-diagnostics,controls}.json`.
