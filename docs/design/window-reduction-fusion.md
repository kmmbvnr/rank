# Window cell reduction fusion

Window geometry and a complete appended-cell reduction can now execute together.
The window producer registers a private fold plan. The reduction runtime uses
that plan when its cell size and alignment match the appended window cell.

The plan computes the window origin once and traverses source coordinates in
the same order as the ordinary window reader. One-dimensional unpadded windows
use consecutive source addresses. Multidimensional windows use a coordinate
counter with source strides; axis order, stride and padding remain supported.

This is producer/reducer composition in the runtime, not a new language construct
or a generated-JavaScript kernel. It benefits the original Euler 8 program:

```rank
Windows = Digits Width window
Products = Windows * reduce rank 1
Answer = Products max
```

It avoids per-element coordinate arrays. It does not eliminate observable
variables or change their materialization. The product array and final maximum
retain ordinary behavior.

## Semantics

The fold reads its first value, then alternates one read and one binary operation.
It preserves subtraction and division order, numeric promotion, errors and source
reader effects. It does not stop early at a zero product.

No new value cache is introduced. Reading a window again after a source mutation
still follows the ordinary window reader. Partial cells, unrelated arrays and
incompatible reduction ranks retain the reference path. Setting host option
`tensorFusion: false` disables this composition for reference comparisons.

The implementation supports arrays, and window producers already expressed as
array windows. It does not change streaming-sequence window iteration.

## Measurements

Base: `a0eaba9`, Node 24.15.0, Apple M5.
Run `node benchmarks/window-fold.mjs` after building. Warm samples alternate
fusion enabled and disabled. The scalar oracle computes every product and the
maximum independently. The original Euler 8 case includes parsing and uses the
unchanged source, checked against its known answer.

| Workload | Reference, ms | Composed fold, ms |
| --- | ---: | ---: |
| 1000 synthetic digits | 1.86 / 1.93 | 1.12 / 1.16 |
| 100000 synthetic digits | 169.58 / 170.93 | 103.76 / 104.66 |
| Original Euler 8, parsing included | 2.16 / 2.07 | 1.48 / 1.56 |

The two isolated runs confirm about 1.6 times improvement at 100K digits and
a smaller end-to-end gain for the original example. A single-window input is
measured too; at that size dispatch overhead dominates and no speedup is claimed.
Raw results are in `benchmarks/baselines/2026-09-12-window-*.json`.

## Validation and next steps

Twelve new tests cover multidimensional layouts, reordered window axes, padding,
stride, empty axis lists, exact reader order, early errors, mutation and
noncommutative operations. All 1036 TypeScript tests passed (45 language and 991 interpreter).

All 1189 demo tests in 341 files passed. The 339 files shared with the previous
stage retain identical test counts and output digests. The demo validation run
took 27.63 seconds; this is not evidence of a whole-suite acceleration.

Further work includes axis reductions, integration with more terminal consumers,
and the worker comparison in the [fusion plan](tensor-fusion-plan.md).
