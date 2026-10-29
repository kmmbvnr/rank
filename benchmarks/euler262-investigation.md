# Euler 262: Mountain Range investigation

Base: `05cec253`, Node v24.15.0, macOS arm64, 2026-10-29. Issue #447 still lists the default program as an execution-budget exclusion; its fixture says the default takes eight minutes. That historical duration does not reproduce on current main.

The investigation below records the original prototype comparisons. The delivery section records the final implementation and its separate verification. The original Rank source is retained at `experiments/euler262-original.ra` for repeatable controls.

## Delivery

The final implementation retains array-based height/visibility calculations, adds an early rejection on a subset of the original samples, and fixes both general compiler limitations. `visible` takes an explicit threshold and returns a boolean. The original coarse test stays; the full default assertion and compiled regression are added, and the default execution-budget exclusion is removed. No timeout or numerical tolerance was raised.

Final samples were collected after all test processes completed, using the actual shipping source and rebuilt compiler. These samples had higher latency in *both* controls than the earlier investigation; they are kept separately rather than pooled. Host load averages observed during this series were 5.37 / 6.89 / 6.62, and unrelated host activity was not controlled.

| Mode | Original median (range) | Shipping median (range) | Speedup |
|---|---:|---:|---:|
| compiled | 6.802 s (6.787–6.886) | 3.239 s (3.228–3.249) | 2.10x |
| reference | 19.058 s (18.890–19.429) | 13.799 s (13.700–14.124) | 1.38x |

All 12 final runs return `2531.205` with matching unrounded `Best`, `F`, contour vertex count and complete visibility/distance signatures. Independent direct-JavaScript full sampling checked 28,093 sight lines and 58,791,566 heights across Step=8 and Step=2 in both engines and Step=1 compiled, reproducing every mask, endpoint distance and final route. This verifies the existing sampled computation, not its continuous geometric assumptions.

Validation passed: language/interpreter TypeScript build and interpreter test typecheck; **9,411 ordinary interpreter tests in 417 files**; **1,487 language tests**; **four scoped type/differential checks**, including both fixture blocks; **11 semantic tests**, **65 semantic owners**, and application-form checks. Added regressions cover unrelated real arrays beside integer indexes, actual index aliases, separate wrappers sharing entries, numeric special values/domains, checked native calls and warmed-helper binding replacement. Initial integration-test failures exposed the helper's outer-threshold dependency and the catalogue's required examples; both were corrected before the final green run.

The tested code baseline is `05cec253`; delivery fast-forwards two unrelated documentation commits to parent `18625265`. The compiler and demo sources are unchanged by that integration. Raw delivery samples and oracle results are under `delivery` in the baseline JSON.

## Current program and bottlenecks

The program samples the height field on a square grid, sorts the cells by height, and activates/joins them using union find until A and B connect. It builds a contour by marching squares, picks the longest connected contour, and tests sight lines from both endpoints to its vertices. Finally it minimizes the sum of the two straight legs and the shorter contour arc.

With grid spacing s, the grid has V = (1600/s + 1)^2 cells: sorting costs O(V log V), and connectivity visits O(V) neighboring cells with path compression. Visibility tests each of P contour vertices using approximately distance/0.5 height samples. The final visible-vertex pair search is quadratic but currently a small part of the runtime.

A single instrumented original default run took 3.903 s: approximately 0.343 s through grid generation/sort, 0.066 s connectivity, 0.477 s through contour selection, 0.014 s setup, 2.950 s visibility and 0.052 s final pair search. These exploratory phase timings are not the repeated benchmark below. Current full compiled timing is seconds, not minutes.

The `vis` helper eagerly completes `Tq`, `Xq` and `Yq`; `hgt` then performs its height arithmetic on those arrays. Every sample is evaluated before the maximum can reject a sight line. This is algorithmic excess work plus execution/materialization overhead, rather than an inherently eight-minute search.

## Two general compiler findings

1. `hgt` fails scalar-function proof at real `Q abs`; `vis` fails at `sqrt`. Adding guarded compiled native-call contracts for real `abs`, numeric `sqrt`, and numeric `exp` allows scalar height evaluation and a streaming visibility helper to compile. Existing loop inlining covers some of these operations, but the scalar helper proof does not. The `abs` contract intentionally covers only real input; integer behavior remains unchanged. This is a reusable compiler improvement, not an Euler-specific recognition.
2. The contour construction uses an integer-valued `index` (`Ep`) and separate real coordinate arrays (`Px`, `Py`). The compile-time `container-write-type` check rejects the entire region whenever any typed integer index and any noninteger destination coexist. It cannot distinguish those unrelated arrays from an actual alias of the index. The prototype defers this check to entry, comparing the concrete destination objects with the guarded integer indexes before execution/writes. An actual noninteger write through an alias still falls back. This admits one compiled contour loop instead of thousands of separately invoked inner loops.

The prototype retained the alias protection at entry; simply deleting the guard is not a valid fix. Its initial real-loop and integer-loop suites passed **338 tests**. The final implementation compares backing entries, also catching distinct index wrappers that share a store, and precomputes the relevant destinations during preparation. Delivery adds unrelated-array, actual-alias and shared-store regressions, plus numeric helper domain/binding checks.

## Compared variants

All samples use the full default Step=2. Each row has three fresh sequential processes, alternating rows between rounds. No test/build workload was running during this series; unrelated host activity was not controlled.

| Compiler | Visibility implementation | Mode | Median | Range |
|---|---|---|---:|---:|
| Current main | Original arrays | compiled | 4.005 s | 3.907–4.056 s |
| Current main | Original arrays | reference | 11.079 s | 11.059–11.348 s |
| Prototype | Original arrays | compiled | 3.799 s | 3.766–4.086 s |
| Prototype | Scalar stream + early rejection | compiled | 1.128 s | 1.116–1.156 s |
| Prototype | Array precheck + original full check | compiled | 1.905 s | 1.897–1.936 s |
| Prototype | Array precheck + original full check | reference | 8.070 s | 8.044–8.162 s |

The compiler patch alone has a small effect here, with overlapping timing ranges. Its main value is admitting useful scalar helpers and the mixed index/array contour region. Combining it with the streaming early rejection gives **3.55x** compiled speedup. However, that source form regresses without compilation: the coarse Step=8 stream/early prototype takes 6.518 s reference versus 1.964 s for the original (single runs; the original is from the later cross-check batch). A naive scalar rewrite without the missing compiler contracts is much worse still: a full-max Step=8 scalar loop took about 53.8 s. Neither result supports shipping a blind array-to-loop rewrite.

The array precheck preserves the existing full array calculation for survivors. First it tests approximately 16–17 regularly spaced indices from the *same* original sample grid. If any already exceeds `Lim`, the caller's visibility comparison is necessarily false, so the full array is unnecessary. Otherwise it executes the original calculation. This gives **2.10x compiled** and **1.37x reference** speedups while keeping array-oriented source.

A 128-cell blocked-array early-exit variant was also tried and rejected: about 4.35 s compiled / 11.87 s reference in single exploratory default runs. Its many small helper/array invocations erase the benefit of rejecting early.

Peak RSS is recorded in the raw JSON. It varies across processes and variants; this investigation does not establish a precise retained-memory saving.

## Correctness and numeric scope

Every repeated run returns `2531.205`, with the identical unrounded `Best`, grid threshold `F`, contour length in vertices, and SHA-256 signatures of both visibility masks and both endpoint-distance arrays. Thus the early rejection preserves the downstream decisions, even though a rejected line no longer returns its exact maximum height. This optimization is justified by the current internal consumer (`maximum <= Lim`); it is not a general replacement for an externally visible maximum operation.

Eight additional fresh-process cross-checks at Step=8 and Step=1 preserve the same signatures and unrounded results across the compared variants/modes. The existing coarse Step=8 fixture returns `2531.2`. A finer Step=1 run returns `2531.205`, matching the default rounded result. Grid connectivity, linearly interpolated contours, half-unit sight sampling and selection of the longest contour remain approximations. Agreement between two grid spacings is a convergence check, not a proof of three-decimal accuracy for the continuous problem. No visibility samples were removed from lines accepted by the precheck; no tolerances or rounding rules were relaxed.

The continuous task statement is at https://projecteuler.net/problem=262. This investigation retains the existing numerical method and does not prove or replace its geometric assumptions.

## Scope selected after investigation

The selected implementation fixes the two general compiler limitations and uses the array precheck for a balanced improvement in both execution modes. Keep the faster scalar stream as a benchmark control. A larger compiler project could lower the original array-producing helper and maximum consumer into one streaming region, preserving ordinary eager-binding boundaries and error timing. That would aim to obtain the scalar stream's speed without forcing a reference-mode source regression; this capability is outside this change.

The final `visible` helper explicitly accepts its threshold and returns a boolean. It has no dependency on outer search state and does not expose an approximate maximum as an exact result. The isolated helper regression is updated to exercise this contract.

## Reproduction

Use a built checkout of base commit `05cec253` as one runtime and the rebuilt delivery checkout as another. `RUNTIME` is the absolute path to that checkout's `packages/interpreter/out/index.js`. Historical `early`/`precheck` source variants are generated from the original snapshot; `shipping` executes the actual final demo.

```sh
RUNTIME=/baseline/packages/interpreter/out/index.js node benchmarks/euler262-mountainrange.mjs 2 compiled original
RUNTIME=/baseline/packages/interpreter/out/index.js node benchmarks/euler262-mountainrange.mjs 2 reference original
RUNTIME=/prototype/packages/interpreter/out/index.js node benchmarks/euler262-mountainrange.mjs 2 compiled early
RUNTIME=/prototype/packages/interpreter/out/index.js node benchmarks/euler262-mountainrange.mjs 2 compiled shipping
RUNTIME=/prototype/packages/interpreter/out/index.js node benchmarks/euler262-mountainrange.mjs 2 reference shipping
```

For an independent direct-JavaScript full-sampling visibility check, run `RUNTIME=/delivery/packages/interpreter/out/index.js node benchmarks/euler262-visibility-oracle.mjs 2 compiled` (or `reference`). It verifies both visibility masks, both endpoint-distance arrays and the final route using every original sample; it is not a continuous-geometric oracle.

Set `PHASES=1` for phase timing marks. Other variants are `stream` (full scalar maximum) and `blocked` (128-cell blocks). `baselines/2026-10-29-euler262-investigation.json` contains all repeated samples and selected exploratory controls. The harness asserts the observed default/finer and existing coarse answers and emits visibility/distance signatures to compare variants.
