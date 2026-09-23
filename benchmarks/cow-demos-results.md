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

## Guarded reader followed by a write

The original run used `node benchmarks/borrow-read-write.mjs 256 64` and
`node benchmarks/borrow-read-write.mjs 65536 64` before integer division was
accepted by the borrow proof. Each batch
prepares 64 fresh owned arrays outside the timer, calls a reader, checks CoW
ownership, and writes one cell. The guarded reader uses `V (I + 1)`; the
local reader uses `J = I + 1` and then `V J`. The former fallback used `V (J // 1)`;
it computed the same index, but the proof did not handle division. Each mode
has two warmups and nine alternating timed batches.

On Apple M5 / Node v24.15.0:

| Cells per array | Reader | Median batch | CoW copies | Cells copied |
| ---: | --- | ---: | ---: | ---: |
| 256 | Direct | 0.071 ms | 0 | 0 |
| 256 | Local selector | 0.077 ms | 0 | 0 |
| 256 | Fallback | 0.759 ms | 64 | 16,384 |
| 65,536 | Direct | 0.111 ms | 0 | 0 |
| 65,536 | Local selector | 0.123 ms | 0 | 0 |
| 65,536 | Fallback | 180.631 ms | 64 | 4,194,304 |

The fallback has an extra integer division, so these times do not isolate the
borrow proof's cost. This is a lower-level reader-and-write path, not a full
Rank program. A fresh run of the unchanged Deep-ML demos at size 2048 still
recorded 0, 1 and 0 CoW copies for gradient descent, K-means and Adam. Their
median times were 107.2, 47.3 and 25.2 ms. This reader proof has no measured
speedup in those demos.

The proof now accepts `//` and `%` with bigint operands. A new run at 65,536
cells and 32 calls measured `V (J // 1)` at 0.063 ms with no CoW copies; before
the change, the same expression measured 90.848 ms with 32 copies of 65,536
cells. The runs were separate, not paired across versions. The current
unsupported control uses `V (J ** 1)` and measured 89.293 ms with 32 copies.
Exponentiation adds different work, so this control checks the copy boundary,
not an isolated speed ratio. A fresh run of the unchanged Deep-ML demos at
size 2048 measured 107.1, 47.9 and 25.0 ms for gradient descent, K-means and
Adam, with 0, 1 and 0 CoW copies. This extension has no measured speedup in
those demos.

A straight-line local can now hold a scalar read from a guarded flat array:
`Cell = V (I + 1); return Cell`. In a fresh run of
`node benchmarks/borrow-read-write.mjs 65536 32`, this case made no CoW
copies and took 0.058 ms per batch (median of nine alternating samples).
The direct reader took 0.059 ms with no copies. The unsupported `**` control
made 32 copies of 65,536 cells and took 95.991 ms. Inputs were prepared outside
the timer. These cases execute different expressions, so their times do not
isolate the proof's overhead or show a speedup in an existing demo.

The local can also hold a result from a resolved reader helper. A run of
`node benchmarks/borrow-read-write.mjs 65536 32` measured
`Cell = V (I + 1) readat; return Cell` at 0.168 ms per batch with no CoW
copies. The direct reader measured 0.051 ms in the same run. The helper adds
call work, and this comparison does not isolate the benefit of borrowing.
Replacing `readat` with a function that returns `V` invalidates the proof;
the runtime test confirms that a later write still copies as needed.

A boolean branch is now eligible when the true path returns `V 1` and the
false path returns `V 0`. The call checks that `Flag` is boolean.
`node benchmarks/borrow-read-write.mjs 65536 32` measured this
reader followed by a write at 0.225 ms per batch, with zero CoW copies in
all nine samples. The direct reader measured 0.068 ms in the same run. The
branch executes different work, and neither time is a demo speedup. The
unsupported exponentiation control copied 2,097,152 cells per batch.

The branch-local case assigns `Cell = V 0` or `Cell = V 1` in the two
branches and returns `Cell`. On Apple M5 / Node v24.15.0,
`node benchmarks/borrow-read-write.mjs 65536 32` measured 0.141 ms per
32 reader-and-write calls (median of nine alternating batches), with zero
CoW copies in every batch. The unsupported exponentiation control made 32
copies of 65,536 cells per batch and measured 134.511 ms. These paths do
different work; this confirms copy avoidance, not an isolated speedup or
a measured gain in a demo.

A counted reader loop now also qualifies when it reduces scalar cells into a
local scalar: `Total += V I` inside `for I in 0 until N`. On Apple M5 / Node
v24.15.0, `node benchmarks/borrow-read-write.mjs 65536 32` measured 9.295 ms
per 32 scan-and-write calls (median of nine alternating batches), with zero
CoW copies. The `I ** 1` control made 32 copies of 65,536 cells and measured
98.552 ms. The control executes a different selector expression; the result
shows copy avoidance in this workload, not an isolated benefit from the new
proof or a demo speedup.
