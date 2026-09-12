# Axis statistics reader fusion

The PCA profile identified repeated gathering and copying in axis statistics.
The runtime now combines cell reads and arithmetic for the standard `mean axis`
and `std axis` operations, across the existing axis layouts.

Mean accumulates its sum while reading and needs no cell-value buffer.
Standard deviation retains one numeric buffer for its second, squared-difference
pass. This removes the intermediate Rank array, its repeated collection and
the extra numeric conversion array. Arithmetic order and population variance
remain unchanged.

This is a runtime reader/reducer composition. It does not extend parser syntax
or change the laziness of axis results. The general ranked-window case is
covered separately by [window cell fusion](window-reduction-fusion.md).

## Error and mutation behavior

The ordinary implementation reads the complete cell before validating values.
The fused reader records the first invalid value and defers its diagnostic
until all source reads finish. Thus a later reader error still takes precedence
over an earlier invalid numeric cell. Missing values are skipped as before.

Numeric accumulation before validation has no external effects. Nonfinite
standard-deviation values still raise the original domain error. Empty cells
retain their empty-reduction error. The optimized path is guarded by the
identity of the standard native operation.

Indexed reads still recompute after a source mutation. No new cache is introduced.
The separate proposal to cache demanded axis cells remains undecided and is not
needed for this optimization.

## Measurements

Base: `824a627`, Node 24.15.0, Apple M5.
The unchanged Deep-ML 019 PCA function is measured using
`benchmarks/fusion-domains.mjs pca`. Set `TENSOR_FUSION=off` for the reference
path. Output forcing is included, and the known principal component is checked
outside the timer.

At 2048 observations, median warm calls were 232.92 and 232.33 ms on the
reference path, versus 165.16 and 163.26 ms with fusion. Run order was
reference/candidate followed by candidate/reference. This is about 1.4 times
faster for the whole unchanged function. At 32 observations the medians were
0.316 and 0.264 ms; no strong small-input conclusion follows from those timings.

The algorithm still recomputes statistics on repeated indexed reads. This stage
reduces their cost without changing asymptotic complexity. Raw measurements are
in `benchmarks/baselines/2026-09-12-axis-*.json`.

## Validation

All 1044 TypeScript tests passed (45 language, 999 interpreter).
Eight new tests cover multiple axis layouts, exact scalar oracles, large and
mixed numbers, signed zero, nonfinite values, missing data, competing error
sources and mutation after a first indexed read.

All 1189 demo tests in 341 files passed, with identical per-file test counts and
output digests to the window stage. The validation run is saved with the focused
benchmarks; it is not a whole-suite speedup claim.

The next release check in the [fusion plan](tensor-fusion-plan.md) is the worker
comparison against the improved local implementation.
