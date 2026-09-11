# Tensor fusion: coverage and measurements

2026-09-11. This measures the default tensor compiler against the same interpreter
with `tensorFusion: false`. Both include the existing inline arithmetic/reduction
optimizations. It is not a comparison against an old checkout or the experimental
hot-loop VM. No Rank demo source was changed.

## Larger unchanged tasks

Apple M5, Node v24.15.0, five samples per mode, alternating which mode runs first.
Each sample uses fresh interpreters and validates a digest of the complete output
and returned value against all other samples. Timing includes parsing, module
loading, compilation, execution, forcing returned values and validation; it
excludes Node startup. Runtime counters confirm actual fused executions.
These are local process timings, not CSES judge measurements.

| Task and input | Reference ms | Fusion ms | Speedup | Kernels/run |
| --- | ---: | ---: | ---: | ---: |
| Stick Game n=100000 k=100 | 1875.795 | 340.612 | 5.51x | 100000 |
| Jacobi 128x128, 10 iterations | 22.212 | 19.020 | 1.17x | 128 |
| Linear SVM 32x64, 3 iterations | 27.470 | 8.993 | 3.05x | 3072 |
| Backprop 512x8, 10 epochs | 14.830 | 11.875 | not attributed | 0 |
| Euler 6 Limit=200000 | 12.987 | 11.618 | not attributed | 0 |
| Linear equations 40x41 | 4.153 | 4.046 | not attributed | 0 |

Backprop and Euler 6 perform no fused kernels in this revision. Differences in
their timings are not evidence of tensor-fusion gains: warmup, process order and
GC can influence small measurements even with alternating mode order. Linear
Equations is also a non-fusing control. Raw samples retain these differences.

Jacobi fuses its first iteration's row dot products. Later `round` results are
lazy inputs and retain their reference semantics, so it does not fuse all 1,280
row calculations. The SVM benchmark uses the linear kernel.

## Entire Rank demo test suite

Three samples per mode with alternating order, 288 files and
1018 tests per sample. Every test passes, and complete test results/output
match across all six runs. Median total wall times:

- Reference: **43.470 s**.
- Fusion: **44.861 s**.
- Ratio: **0.969x**: the fusion-enabled median is **3.2% slower** in this run.
  There is no whole-suite speedup to claim. Individual run ranges overlap;
  smaller dispatch/compilation overhead and process variability still need
  further measurement.

The total includes test assertions, IO, parsing and compilation. It is separate
from the TypeScript unit suite. The following demo-test files actually execute
fused kernels; all other files remain on reference tensor paths:

| Test file | Reference ms | Fusion ms | Kernels/run |
| --- | ---: | ---: | ---: |
| `demos/cses/math/016_permutationrounds_test.ra` | 3.400 | 3.702 | 7 |
| `demos/cses/math/032_stickgame_test.ra` | 2.221 | 2.904 | 29 |
| `demos/deepml/011_jacobi_test.ra` | 2.533 | 2.861 | 5 |
| `demos/deepml/019_pca_test.ra` | 7.873 | 5.364 | 1 |
| `demos/deepml/021_svm_test.ra` | 21.445 | 21.285 | 1604 |

The PCA count comes from its shape assertion, not from the PCA algorithm.
The other four files exercise fusion in their imported solution functions.

Small tests can cost more to compile than they save in execution. Large-input
benchmarks establish throughput benefits; the full suite checks total overhead
and correctness. Fusion has not yet reached most of the expensive demo programs.

An early integration checked a second optimizer cache for every assignment and
regressed scalar loops. Eligibility now lives on the existing prepared statement.
The separate scalar-control measurements no longer show the earlier large
regression. They do not establish zero overhead for the complete suite.

## Verification and reproduction

`npm test` passes 44 language tests and 557 interpreter tests, including 39 focused
tensor-fusion tests. Test TypeScript compilation also passes. Focused tests compare
values, output and formatted errors/locations between modes, including empty
inputs, scalar error timing, power/sign precedence, numeric order, mutation,
lexical shadowing, escaping intermediates, browser CSP fallback and independent
Stick Game DP answers.

```sh
npm run bench:fusion -- tasks compare 5
npm run bench:fusion -- suite compare 3
npm run bench:fusion -- suite compare 3 \
  '(006_sumdivisors|010_looksay|014_christmasparty)_test'
```

After building, invoke `node benchmarks/tensor-fusion.mjs` directly to avoid
including build activity before a measurement. Use `on` or `off` instead of
`compare` for a single mode. All per-file timings, counts and result digests are
available in the raw reports:

- [Task samples](../../benchmarks/baselines/2026-09-11-tensor-fusion-tasks.json)
- [Full suite samples](../../benchmarks/baselines/2026-09-11-tensor-fusion-suite.json)
- [Scalar controls](../../benchmarks/baselines/2026-09-11-tensor-fusion-scalar.json)

See the [architectural decision](tensor-fusion.md) for coverage and the path toward
lazy readers, sequence plans, general axis/rank lowering and more expression forms.

## Integration with concurrent Range Queries work

While the original measurements ran, main gained CSES Range Queries in
`080c1d8`. That runtime was merged before delivery. The earlier tables describe
the 288-file snapshot; they must not be compared directly with this expanded
suite. The merged version passes 44 language tests and 577 interpreter tests.

A fresh comparison of the entire expanded suite completed with identical
results/output in both modes:

- Reference: 41.295 s, 306 files, 1054 tests, all passing.
- Fusion: 42.754 s, 306 files, 1054 tests, all passing.

This integration check has one sample per mode, so it is a correctness and
overhead check rather than a stable estimate of a small performance change.
The larger-task comparison was repeated with three alternating samples:

| Task | Reference ms | Fusion ms | Speedup |
| --- | ---: | ---: | ---: |
| Stick Game n=100000 k=100 | 1864.866 | 333.481 | 5.59x |
| Jacobi 128x128, 10 iterations | 21.994 | 18.929 | 1.16x |
| Linear SVM 32x64, 3 iterations | 27.488 | 10.425 | 2.64x |
| Backprop 512x8, 10 epochs | 16.503 | 12.838 | not attributed |
| Euler 6 Limit=200000 | 11.825 | 11.576 | not attributed |
| Linear equations 40x41 | 4.065 | 4.319 | not attributed |

- [Merged suite results](../../benchmarks/baselines/2026-09-11-tensor-fusion-merged-suite.json)
- [Merged task results](../../benchmarks/baselines/2026-09-11-tensor-fusion-merged-tasks.json)
