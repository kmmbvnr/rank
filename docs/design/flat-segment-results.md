# Flat segment trees: memory and timing

This is the initial implementation baseline. The [speed follow-up](flat-segment-speed.md)
measures buffer initialization changes and specialization of pure integer combines.

Measured on Apple M5, Node v24.15.0, macOS arm64. Five fresh-process samples
per variant and size; tables show medians. Raw results include all samples,
runtime hashes, the Rank combine source, and memory components.

## Workload and boundaries

The state has four integer fields: sum, maximum prefix, maximum suffix, and
maximum subarray sum (empty subarrays allowed). Each variant receives identical
deterministic leaves, 10,000 inclusive range queries, and 5,000 point updates.
The harness checks all four fields against a direct linear oracle for the whole
array and 16 ranges, before and after updates. Every variant and repeat must
also produce the same query checksum and final aggregate.

Two combine implementations separate representation cost from interpreter cost:
a JavaScript function returning ordinary record objects, and an actual Rank
function returning Rank records. Both use the same RankSegment traversal,
called from the host harness. Rank parsing, outer Rank loops, and selector
dispatch are outside the timed phases. This is a tree and combine benchmark,
not the wall-clock time of a complete Rank program.

Each child warms a 1,024-element tree with 2,000 queries and updates. Explicit
GC runs outside timed phases; automatic GC remains included. Sample order
alternates. Input creation and tree construction are timed separately.

Memory is the post-GC delta of heapUsed + arrayBuffers from a warmed runtime.
Tree memory is measured after releasing the source array and before allocating
the correctness oracle. Boxed trees retain their leaf records; flat trees retain
their own buffer. This measures retained memory after construction, not peak
memory or total allocation traffic. RSS is recorded but not used for the table.

## Results

### 65,536 elements

| Combine / storage | Input ms | Build ms | 10k queries ms | 5k updates ms | Tree MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| js-boxed | 16.5 | 25.8 | 61.8 | 28.1 | 59.32 |
| js-flat | 26.7 | 67.3 | 47.8 | 50.4 | 4.07 |
| rank-boxed | 17.6 | 209.4 | 398.2 | 245.1 | 67.04 |
| rank-flat | 28.7 | 250.0 | 370.3 | 251.0 | 4.18 |

[Raw samples](../../benchmarks/baselines/2026-09-12-flat-segment-65536.json).

### 262,144 elements

| Combine / storage | Input ms | Build ms | 10k queries ms | 5k updates ms | Tree MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| js-boxed | 81.8 | 93.5 | 73.2 | 41.1 | 235.51 |
| js-flat | 103.6 | 246.1 | 53.6 | 56.6 | 16.45 |
| rank-boxed | 72.6 | 821.0 | 496.7 | 333.3 | 269.53 |
| rank-flat | 106.9 | 938.5 | 444.4 | 292.5 | 16.56 |

[Raw samples](../../benchmarks/baselines/2026-09-12-flat-segment-262144.json).

## Interpretation

Flat storage reduces retained tree memory by about 16 times with the Rank
combine in both sizes. Its payload is 32 bytes per slot plus one occupancy
byte: 4.125 MiB at 65,536 leaves and 16.5 MiB at 262,144 leaves. The measured
retained totals also include runtime bookkeeping and measurement noise.

Construction is slower in both modes. With Rank combine, median query time
improves in both sizes, while updates are close at the smaller size and faster
at the larger size. These results support compact storage for memory capacity;
they do not establish a speed benefit for every workload.

The JavaScript control exposes the remaining representation cost: flat
construction takes roughly 2.6 times as long, and updates about 1.4 to 1.8
times as long. Every read still constructs record maps, and every store
validates and packs fields. Flat updates also stage their path to preserve
atomicity on overflow; boxed updates do not. The control therefore measures
the current implementations, including that semantic difference.

Runtime allocation and GC behavior may explain why some query timings improve
despite unpacking, but this run does not attribute the cause. The large Rank
samples also show timing drift; use the raw samples rather than treating small
percentage differences as guarantees. No GC-pause profiling was performed.

The next performance step is a combine path that reads and writes scalar fields
without creating ordinary records at each visited node. The current data support
the memory claim, not allocation-free execution.

## Reproduce

```sh
npm run build
node benchmarks/flat-segment.mjs > /tmp/flat-65536.json
node benchmarks/flat-segment.mjs --size=262144 > /tmp/flat-262144.json
```

The harness launches workers with --expose-gc itself. Optional --queries,
--updates, and --samples arguments change the workload. This comparison does
not modify the runtime implementation.
