# CoW profile of existing demos

2026-09-23, Apple M5, Node v24.15.0. Run after
`npx tsc -b tsconfig.build.json`:

```sh
node benchmarks/cow-demos.mjs 256 7
node benchmarks/cow-demos.mjs 2048 5
```

The harness runs the unchanged Deep-ML functions with fresh inputs, excludes
input construction from timing, and forces output cells inside the measured
call. Each size has two warmups. The table shows within-run median time and
the identical CoW count in every measured sample.

| Demo | Input size | Median call | CoW copies | Cells copied |
| --- | ---: | ---: | ---: | ---: |
| Gradient descent (`015_gd.ra`) | 256 | 14.5 ms | 0 | 0 |
| Gradient descent (`015_gd.ra`) | 2048 | 105.7 ms | 0 | 0 |
| K-means (`017_kmeans.ra`) | 256 | 9.3 ms | 1 | 256 |
| K-means (`017_kmeans.ra`) | 2048 | 47.0 ms | 1 | 2048 |
| Adam (`049_adam.ra`) | 256 | 3.2 ms | 0 | 0 |
| Adam (`049_adam.ra`) | 2048 | 25.2 ms | 0 | 0 |

`cowCopiedCells` counts array elements copied by `arrayForWrite`. It is not a
byte or total-allocation measurement. Explicit `copy`, lazy materialization and
new array construction are outside this counter. The timings have no separate
baseline checkout, so they do not show an optimization speedup. The K-means
copy has the length of `Labels`; the follow-up below narrows its cause. The
other two demos offer no measured CoW-copy
opportunity at these inputs.

## K-means follow-up

With 2048 points, `Max = 1` causes no CoW copy; `Max = 2` causes one copy of
2048 cells, and `Max = 3` or `5` still causes one. `Labels` is the only mutable
array of that length in the function. The copy starts when the second pass
writes labels after the first pass has built lazy masks from them. This is a
source-level attribution; no source-location trace was collected.

An isolated `arrayForWrite` microbenchmark on the same machine took a median
0.071 ms per 2048-cell copy over nine batches of 1000 copies. The full K-means
call took about 47 ms at that size. These are different workloads, so 0.071 ms
is an order-of-magnitude estimate of copy cost, not a measured time saving from
removing it. It is too small a lead to justify new liveness rules for this demo.

A sampling CPU profile of 50 warmed K-means calls recorded 2256 samples:
about 30% in garbage collection, 10% in `derivedArray`, and 4% in
`valueRevision`. For comparison, 15 gradient-descent calls recorded 1297
samples: 24% in the linear-algebra `resultAt`, 18% in sequence `itemAt`, 12%
in `readCell`, and 2% in garbage collection. Fifty Adam calls recorded 968
samples: 18% in `readArrayItem`, 15% in `readCell`, and 11% in garbage
collection. These are profiler samples, not precise elapsed-time shares, and
the calls and sample totals differ, so the percentages should not be used as
cross-demo timing ratios.

The profiles do not support one universal CoW or allocation bottleneck.
Repeated per-cell reads are a more promising shared investigation for the
gradient and Adam demos; K-means has a separate allocation lead. Neither is
yet an optimization result. Establish a before/after demo baseline before
changing the reader representation or adding a specialized path.
