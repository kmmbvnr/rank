# Broadcasting and iteration-domain profiles

The array-output compiler now binds broadcast shapes using the ordinary runtime
shape rule. It emits source addresses from result coordinates, with strides
prepared outside the cell loop. The expression tree, integer arithmetic and
left-to-right reduction order are unchanged.

For example, a matrix can combine with per-column vectors:

```rank
Centered = Data - Mean
return (Centered / Dev) copy
```

Private intermediates, scalar operands, singleton axes and higher-dimensional
broadcasts use the same plan. Both explicit copy and terminal reductions can
consume the plan. Gathers, filters and text-digit conversion remain outside
broadcast composition until their distinct domains are modeled. Incompatible
shapes retain the ordinary error path.

This does not automatically materialize lazy intermediate values. It does not
make the unchanged PCA example use this kernel: PCA passes its lazy standardized
matrix into covariance rather than an explicit copy or supported terminal
reduction.

## Measurements

Base: `f12fca9`, Node 24.15.0, Apple M5. Run
`node benchmarks/broadcast-fusion.mjs` after building. Seven warm samples alternate
between tensor fusion enabled and disabled. The benchmark includes output
materialization, checks shape and every value against an independent scalar
oracle, and measures the first call separately.

For a 32768 by 32 matrix, the first run measured 312 ms without fusion and
9.4 ms with fusion. For 4096 by 32, it measured 26.3 ms and 1.2 ms.
These results concern the explicit materialization expression above, not PCA
end-to-end. Empty inputs take microseconds and do not show a useful speedup.

The raw runs are in `benchmarks/baselines/2026-09-12-broadcast-*.json`.

## Profiles of unchanged examples

`node benchmarks/fusion-domains.mjs pca|gradient|windows` executes the original
example source. PCA uses 2048 perfectly correlated two-feature observations with
a known principal component. Gradient descent uses a one-hot design with a closed
form expected answer. Euler 8 uses its original 1000-digit input and known answer.
Checks happen outside the timed region; lazy results are forced inside it.

Separate Node CPU profiles identify these next targets:

- PCA: `reduceAt` accounts for about 1056 ms of 3309 ms of sampled self time;
  statistics callbacks and tensor reads dominate much of the rest. Axis mean and
  standard deviation are recomputed when broadcast consumers read them again.
- Gradient descent: coordinate calculation and matrix multiplication dominate.
  Adding a copy terminal alone cannot remove those costs.
- Euler 8: window coordinate calculation and cell reduction appear in the hot
  path. The original example is small, so larger window inputs still need
  separate measurement before choosing a kernel.

Profile summaries and uninstrumented runs are saved in
`benchmarks/baselines/2026-09-12-domains-*.json`.
The profiles include startup; percentages are not pure steady-state kernel
percentages. PCA timing varies substantially across these runs.

## Pending semantic decision

Axis reduction results currently recompute on indexed reads, so changing the
source can change an already-read result. Caching demanded cells would improve
reuse but change that behavior. This needs a user decision before implementation;
the broadcasting compiler change does not alter it.

The [main fusion plan](tensor-fusion-plan.md) still includes axis/rank traversal,
window reductions, completed storage and a new worker comparison.

## Validation

All 1024 TypeScript tests passed (45 language and 979 interpreter). Eight new
broadcast tests cover matrix/vector arithmetic, singleton axes, rank-zero arrays,
three-dimensional domains, empty dimensions and incompatible shapes.

All 1183 demo tests in 339 files passed.
The 334 files shared with the previous stage have identical test counts and
output digests. New Kaggle tests were already present in the base revision.
The run took 27.56 seconds; it is a validation run, not evidence
of whole-suite acceleration.

A second isolated focused run measured 308.4 to 9.37 ms at 32768 by 32,
confirming the materialization gain.
