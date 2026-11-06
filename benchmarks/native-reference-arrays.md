# Native reference array operations

The reference interpreter now uses the existing exact integer writer for
trusted packed integer RHS arrays and scalar compound updates. It snapshots
RHS values before scatter, preserves ordinary duplicate-index semantics and
copy-on-write aliases, and widens integer storage exactly. Scalar accumulated
updates also use the existing native accumulator. No JavaScript is generated.
Demand budgets, observable host polling and inspection keep their existing
traversals. The pre-existing scalar linear replacement budget path is unchanged.

Completing `concat` of registered finite integer ranges now fills the final
Int32/Int64 buffer directly. Replaced range methods or metadata, demand budgets,
observable polling, mixed element types and arbitrary-precision endpoints
retain the ordinary path. Cancellation checkpoints remain between blocks.

Controls use isolated sources at `f3b46c20`; the after runtime is built from
only this change, excluding the other Euler 445 experiments. Each sample is a
fresh Node v24.15.0 process with compilation disabled, including parse and sum.
Answers are checked independently; compiled loop/tensor counts must be zero.

| Host | Workload | Before, ms | After, ms | Before RSS, MiB | After RSS, MiB |
| --- | --- | ---: | ---: | ---: | ---: |
| Apple M5 / arm64 | 2M-cell update | 529.92 | 102.13 | 525.19 | 189.95 |
| Apple M5 / arm64 | concat ranges, 4,666,667 cells | 444.75 | 96.15 | 510.92 | 180.16 |
| Intel i7-10750H / x64 | 2M-cell update | 1334.92 | 261.87 | 610.18 | 182.47 |
| Intel i7-10750H / x64 | concat ranges, 4,666,667 cells | 1080.56 | 251.63 | 483.23 | 173.07 |

These are medians of six alternating pairs per workload on Mac and three on
Intel. The second three Mac pairs reverse the order. All samples are retained,
including a 1129 ms Mac after-update outlier; the ranges and raw measurements
are in `baselines/2026-11-07-native-reference-arrays.json`. Intel `vmstat` samples
before each run report 91–92% idle CPU and no swap-in/out during the interval.
This does not establish the load during older Euler 445 measurements.

Run either control workload with:

```sh
node benchmarks/native-reference-arrays.mjs updates
node benchmarks/native-reference-arrays.mjs ranges
```

Set `RANK_BENCH_RUNTIME` to a control runtime's `out/index.js` file URL.

Verification: isolated build; 466 focused tests across 17 files on Mac and
Intel, covering native writes, aliases, repeated indices, widening, concat,
ranges, budgets, interruption and storage. Exhaustive audits were not run.
Euler 445 is still under investigation; its production program is unchanged
and this delivery does not mark its issue row complete.
