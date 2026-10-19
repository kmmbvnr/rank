# Stored numeric collection measurements, 2026-10-19

Issue [#312](https://github.com/kmmbvnr/rank/issues/312). Node v24.15.0,
darwin/arm64. Baseline: `96a22cbdb1206c3229c579287444373b255abef2`;
measured runtime: `d44ed2e1e0172c8e327db3cb5d20103289f3904f`. Later report/documentation commits
do not change runtime source. Baseline samples come from the preceding comparison;
final candidate samples follow the storage-reader cleanup. Each sample uses a
fresh process, with three samples per operation and medians below.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/numeric-collections.mjs
node benchmarks/numeric-collections.mjs --baseline=/path/to/baseline/out/index.js
```

Operations use 5,000,000 integers from the issue's expression, except `find-many`,
which uses 100,000 integers and 64 targets near the end of the source. `find`
finds zero at position 1,000,002. `unique-count` is fused `A unique len`.

All times are seconds. Operation time includes parsing the operation expression,
admission, copying/conversion, hashing/sorting and construction of the Rank result.
It excludes initial input construction and startup. Execution cold time is the
child's Node performance clock at operation completion: imports, interpreter
initialization, input construction and the operation. It excludes subsequent
result validation; raw `processMs` additionally includes validation and child
process launch/teardown, so it is not an execution-only cold measurement.

| Operation | Baseline operation | Candidate operation | Speedup | Baseline execution cold | Candidate execution cold |
|---|---:|---:|---:|---:|---:|
| `sort` | 3.335 | 0.268 | 12.5x | 4.809 | 1.902 |
| `unique` | 2.711 | 0.317 | 8.6x | 4.204 | 1.787 |
| `unique-count` | 2.638 | 0.291 | 9.1x | 4.116 | 1.777 |
| `argsort` | 3.808 | 0.348 | 10.9x | 5.535 | 1.803 |
| `find` | 0.086 | 0.018 | 4.7x | 1.564 | 1.497 |
| `find-many` | 0.778 | 0.016 | 47.4x | 1.192 | 0.421 |

The first candidate sort sample constructs its input in 1.237 s
and records 0.237 s before construction. Every worker validates
its result outside the operation timer: the complete sorted distribution,
first-appearance unique sequence, stable permutation and exact search positions.
Diagnostics also require actual numeric-kernel execution, including exactly one
index for the 64-target search. Raw samples are in
[the JSONL report](baselines/2026-10-19-numeric-collections.jsonl).

## Euler 155

The unchanged default `Count = 18` program returns **3857447** in both versions.
One sequential cold CLI process per version: **31.425 s → 18.199 s**
(1.73x). Both processes exited zero. This is a single end-to-end sample,
not a median or a new profile of per-operation cost. No demo rewrite was needed.
[Raw demo results](baselines/2026-10-19-numeric-collections-euler.jsonl).

## Scope and costs

Integer sorting narrows only after checking signed-64-bit range. Stable Int32
permutations use three radix passes; wider exact keys use typed position sorting
with a comparator. Real ordering containing NaN or negative zero, mixed kinds,
wider integers, missing/lazy values and pending binding wrappers retain generic
ordering. Unique preserves the first original real value, including NaN and -0;
wider-than-Int64 integer unique retains structural hashing. Numeric search uses
exact canonical keys across integer/real targets and separates booleans.

Native sorting retains the generic checkpointed path when an interrupt signal
is installed. Numeric distinct/search loops poll cooperatively. This benchmark
uses ordinary file/API execution without a signal; it does not claim the same
sort speed in interactive workers.

Results own fresh storage. Int32 permutations require three Uint32 work buffers
(keys, positions and scratch: 60 MB for 5M cells), in addition to numeric values
and the final result. Numeric hashes scale with distinct cardinality; this input
has 1,000,003 distinct values. There is no persistent mirror or global index.
Peak heap and allocation savings were not measured; these timings do not prove
sub-0.5 s behavior for other distributions or arbitrary real/wide-integer arrays.
