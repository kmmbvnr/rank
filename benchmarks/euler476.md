# Euler 476: fused real helpers and shape-only private reshapes

The original program already compiled its outer loop. Its cost came from materializing each matrix arithmetic stage, repeated real-storage classification, and copying reshaped coordinates. It enumerates 244,623,302 triangles at N=1803; the algorithm is still a complete enumeration.

The program now expresses the circle calculation as a pure `covered` function. Its column and offset arguments broadcast directly; no expanded coordinate grids are required. Heron's factors make the geometry explicit. The main program has one loop, the helper has none, and Rank lines fit 40 columns. The rounded answer remains **110242.87794**.

## General compiler and runtime changes

- Pure real-array helpers with ordinary eager local bindings can run as one pointwise DAG inside a Number loop. Scalar, vector and matrix operands retain broadcasting; named common subexpressions become scalar temporaries. Arithmetic, real powers and binary min/max are supported. The output uses the existing private vector pool, with input and retained-result protection.
- Function-plan typing and inline emission preserve matrix shapes through arithmetic, unary operators and binary extrema. Reindexed shared stages keep per-cell caches; one-dimensional pointwise producers retain their existing load sharing.
- Private reshape shares cells with copy-on-write instead of copying them. Publishing aliases with different dimensions preserves each shape and ordinary later mutation behavior.
- Proven real result cells use direct Float64 writes. Integer stores retain their widening checks.
- Real storage contracts use bounded native infinity searches instead of a Map update per cell. The same block checkpoints remain. Inspection and demand budgets keep the generic scan; NaN remains real and infinities remain numeric limits.

The new helper path is deliberately finite and read-only. Unsafe integer intermediates, nonfinite real arithmetic, incompatible shapes, replaced native bindings, unused eager bindings, deferred bindings or unsupported bodies retain/replay ordinary execution. Cancellation and budgets retain their existing execution path. No language semantics or Number-mode threshold changed.

## Correctness and execution lanes

Small independent tests enumerate all three corner candidates using Heron's formula. They cover N=2,3,4,5,6,9,10,11,25,50,51 and all three numeric backends. The existing imported examples remain unchanged. A separate long-double C++ oracle sorts all three corner ratios and confirms the full average **110242.87794426143228**, triangle count **244623302**, and rounded answer above.

The main program returns to ordinary corpus audits; its fixture remains there. A focused compiled full-input golden has a 60-second budget. The filtered differential selects exactly the program and its fixture on each host, rather than running the exhaustive audit.

## Measurements

Both machines had background load. Intel showed substantial disk wait from unrelated work. Controls used fresh processes and alternated original/final order over three rounds at N=600. Full N=1803 results below are single runs, not idle-host medians. CPU time, load, peak RSS, source hashes and runtime kernel hashes are retained in the raw record. Neither machine ran our own tests concurrently with its timed comparisons.

N=600 medians, seconds / peak RSS MiB:

| Host / mode | Original runtime and source | New runtime, original source | Final runtime and source |
| --- | ---: | ---: | ---: |
| Mac compiled | 0.808 / 188.1 | 0.689 / 187.4 | 0.299 / 181.2 |
| Mac reference | 1.963 / 278.3 | 0.915 / 339.7 | 0.711 / 362.2 |
| Intel compiled | 1.760 / 175.8 | 1.425 / 173.5 | 0.686 / 168.4 |
| Intel reference | 3.717 / 259.5 | 1.982 / 275.3 | 1.747 / 315.6 |

Full N=1803, seconds / peak RSS MiB:

| Host / mode | Original runtime and source | New runtime, original source | Final runtime and source |
| --- | ---: | ---: | ---: |
| Mac compiled | 23.893 / 271.9 | 18.271 / 263.8 | 3.953 / 210.2 |
| Mac reference | 57.591 / 652.1 | 20.902 / 791.4 | 17.895 / 701.2 |
| Intel compiled | 39.972 / 244.1 | 31.282 / 243.4 | 10.412 / 189.8 |
| Intel reference | 88.409 / 350.0 | 40.754 / 347.0 | 35.032 / 351.9 |

Compiled peak RSS improves on both hosts. Reference RSS does not universally improve: the full Mac run rises about 7.5%, while Intel is almost unchanged; smaller reference controls rise more. This is a speed improvement with a measured reference memory tradeoff, not a general RSS reduction. A factored-formula prototype reduced intermediate matrices but took 19.681 s / 695.2 MiB on Mac reference, versus 17.895 s / 701.2 MiB for Heron. It was rejected because the memory change was small and runtime worsened.

A plain scalar JavaScript implementation uses the same Heron arithmetic, triangle order and per-side sum boundaries. It remains faster and smaller: the Mac full run took 0.832 s / 50.8 MiB. The Intel scalar-JS full run took 2.195 s / 54.4 MiB. The Rank result is therefore not at handwritten-JS parity. Finite arithmetic guards, array result production and loop-region bookkeeping remain costs.

## Verification and reproduction

501 unique focused checks across 16 files passed on each host (Mac's initial 499 plus two added function-plan cases). These cover broadcasting, empty/singleton axes, signed zero, real power errors, integer overflow replay, native binding replacement, eager errors, cancellation/budgets, retained results, COW reshape publication and storage-kind cache updates. Both selected differential cases passed on each host. Source/test TypeScript projects, semantic-boundary checks, application-form checks and five exclusion-catalogue tests passed on Mac. No full npm test or exhaustive audit was run. A follow-up added 28 passing broadcast/storage checks: checked matrix stages now produce additional compilation hooks, and small range-derived integer arrays may already use compact storage (also reproduced before the Euler 476 changes). The value, shape and alias checks remain intact.

Build interpreter and matching language output before measuring. Use `node benchmarks/euler476.mjs compiled 1803` or `reference`, optionally with `RANK476_EXPECTED=110242.87794`. For controlled comparisons, `node benchmarks/euler476-compare.mjs /absolute/frozen/interpreter/out/index.js 3 600`; the frozen runtime needs its matching language package. The optional final argument selects the input size. Build the independent oracle with `c++ -O3 -std=c++17 benchmarks/experiments/euler476-oracle.cpp`; run it with `1803`. Run the scalar comparison with `node benchmarks/experiments/euler476-native.mjs 1803`.

Selected raw results and verification logs are in [the baseline record](baselines/2026-11-08-euler476.json).
