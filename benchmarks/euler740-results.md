# Euler 740: compact broadcast lanes and reusable transitions

Issue: https://github.com/kmmbvnr/rank/issues/544

The default remains People=100 and the answer remains `0.0189581208`.
The dynamic program still evaluates 9*(People+2)^2 states, 16 ordered draw pairs
and the same 99 stages. The probability model, state encoding and reduction
order are unchanged.

## Full-input measurements

Node v24.15.0; Apple M5 arm64 macOS and Intel i7-10750H x64 Linux, normal CPU
affinity. Each host has one baseline and three serial final runs in fresh
processes. Machine load and frequency were not controlled; baseline variance
was not measured. All full runs returned the same answer.

| Host | Baseline seconds | Final seconds, all runs | Median speedup | Baseline peak MiB | Final median peak MiB |
| --- | ---: | --- | ---: | ---: | ---: |
| Mac | 26.63 | 7.08 / 7.06 / 7.11 | 3.76x | 436.50 | 400.34 |
| Intel | 60.67 | 19.15 / 19.25 / 19.28 | 3.15x | 411.80 | 374.64 |

Median peak RSS fell by 8.3% and 9.0%, respectively. These are modest process
memory savings; avoiding temporary buffers does not imply the same percentage
reduction in peak RSS. Every final peak was below its host's baseline.

Primary files are `results/euler740/base-*-full.json` and
`isolated-final-*-{1,2,3}.json`; derived figures are in `summary.json`.
The baseline snapshot is 76d64b62, with an identical source fixture in
`fixtures/euler740-original.ra`. The first runtime change is f144c1a2; the final
path isolation is 7a4196f1. The Rank change is d000548d.

Earlier final-series samples predate path isolation. In particular, the earlier
Intel median was 16.54 seconds. Those samples are preserved in
`initial-series.jsonl` and are not pooled into the final series or substituted
for its slower result. Each JSONL record retains the original filename and
complete raw result.

## Profile and general interpreter change

A People=40 diagnostic profile identified `mapStoredInt32Binary` as the largest
self-sampling function, followed by real arithmetic, scalar-kind scans and
compact arithmetic. This input preserves the same tensor structure at lower
cost. Diagnostic runs are separate from primary timings; self-sample summaries
are in `profile-summary.json`.

The hot integer operations broadcast small move/bias tables over long rows.
The generic path computed broadcast addresses for each output cell, allocated
a Float64 scratch result, then narrowed it to Int32. A compact row-broadcast
path already existed for multiplication, but the small tables in this source
contained boxed BigInts. Extending only the compact-input branch did not help:
the first full experiment still took 26.90 seconds.

The final `compactBroadcastLanes` helper:

- Reuses prepared, validated scalar views; it does not prepare operands twice.
- Borrows Int32 storage and privately packs at most 64 logical cells of a small
  completed boxed or wide integer view when every selected value fits Int32.
  Offsets and strides are preserved; unrelated cells in a large backing buffer
  are not copied or inspected by that packing pass.
- Computes the two broadcast row addresses once and traverses the contiguous
  lane with its physical stride. It supports addition, subtraction, product,
  minimum and maximum, including either operand order.
- Uses absolute input bounds to prove compact arithmetic results. Min/max of
  Int32 inputs need no widening proof. Addition/subtraction only pay for the
  bounds pass when broadcasting repeats enough input. Wider cases retain the
  existing exact fallback.
- Writes independent Int32 output directly, avoiding the full Float64 scratch
  and narrowing pass. The inherited type checks and cancellation checkpoints
  remain in place. Opaque/lazy readers and unsupported domains retain their
  existing paths.

The additional helper is admitted only for large broadcasts with lanes of at
least four cells. Equal-shape short calls and the existing compact multiplication
implementation keep their original path. No new Rank syntax, task-specific
primitive or approximate arithmetic is introduced.

With the original Rank source, the final runtime measured 10.34 seconds on Mac
(2.57x faster) and 25.05 seconds on Intel (2.42x). These are single runtime-only
samples, stored as `runtime-only-final-*.json`. Peak RSS was 433.39 and 417.05 MiB,
respectively: the runtime change alone barely changed process high-water memory.
The final combined results above also include the following source work.
Earlier f144c1a2 runtime-only exploration measured 10.51 seconds on Mac.

## Rank implementation and memory

`AtOne`, `AtTwo` and the clamped destination map depend only on the fixed state
coordinates and move tables. They are computed once before the stage loop.
The destination map is materialized by one deferred integer expression instead
of retaining separate full-sized clamped-coordinate arrays.

The fixed `Single + 2*Double` category table and
`Used = Own + Last + Single + 2*Double` are also reused. The stage then computes
`Gamma = Total - Used`; this is exact integer reassociation of the original
formula.

The two conditional draw probabilities and their product use deferred bindings.
An explicit `copy` consumes the combined product and continuation gather before
the existing sum over the 16 pairs. The completed continuation table remains a
boundary, so updating Table does not retain a lazy dependency on its old value.
No states, ordered pairs or stages are pruned.

The full golden test records one Number-tensor destination construction and
100 tensor-map preparations (the static map and 99 probability stages). It does
not claim compilation of the complete stage loop into a Number loop.

## Isolated kernels and existing-path controls

`experiments/euler740-broadcast.mjs` applies each operation to 16 boxed lane
constants and a stored vector of 131072 cells: 2097152 output cells. Setup is
outside timing. Every output is independently checked with BigInt after timing;
RSS is captured before that verification. Each entry is the median of three
paired baseline/final fresh processes.

| Operation | Mac baseline / final ms | Intel baseline / final ms |
| --- | ---: | ---: |
| Addition | 69.14 / 7.66 | 177.82 / 14.74 |
| Subtraction | 69.40 / 7.58 | 179.00 / 16.77 |
| Multiplication | 68.94 / 7.84 | 182.31 / 15.89 |
| Minimum | 69.20 / 7.25 | 182.63 / 17.01 |
| Maximum | 69.62 / 7.66 | 180.53 / 16.35 |

An initial inline implementation showed a 4–5.5% slowdown on an existing narrow
multiplication broadcast control. The final version separates the new helper
and restores the original compact multiplication and generic fallback code.
Rechecks use the existing `euler707-arrays.mjs` driver:

| Existing multiplication case | Mac baseline / final ms | Intel baseline / final ms |
| --- | ---: | ---: |
| Compact broadcast | 13.15 / 12.92 | 35.39 / 34.86 |
| Wide-result broadcast | 197.74 / 197.52 | 570.90 / 566.92 |
| Width-one lanes | 70.48 / 71.04 | 196.82 / 195.53 |
| Equal-shape control | 5.08 / 5.09 | 12.49 / 12.73 |

Final kernel/control records are in `kernel-controls.jsonl`; initial samples
are retained in `initial-series.jsonl`. Three samples per case do not establish
statistical zero overhead. The observed final control medians differ by less
than 2% on either host.

## Verification and reproduction

- 194 focused tests passed on each architecture after the final runtime change,
  including existing wide arithmetic, modulo broadcasts, deferred real recipes,
  gather fusion and array-binding contracts.
- New kernel tests cover both operand orders, all five operations, signed and
  wide boundaries, offsets, negative strides, selected small views of large
  backing storage, short/empty shapes, nonreplicated shapes, budgets,
  cancellation and retry.
- Sixteen problem tests cover People=1..8 in both compilation modes using an
  independent labelled-slip enumeration. It enumerates each allowed first and
  second name draw with its actual probability and retains the individual name
  counts; it does not use compressed categories or pair tensors.
- The published q(3)=0.3611111111 and q(5)=0.2476095994 examples are checked
  against https://projecteuler.net/problem=740. The default golden is also
  compared with the frozen original solution.
- The final default golden passed in 7.08 seconds. TypeScript build, semantic
  boundaries (65 owners) and application-form checks passed. No exhaustive
  audits or full workspace test suite were run.

Verification logs and raw intermediate measurements are beside the final data.
Build outputs before reproducing:

```sh
npm run langium:generate
node node_modules/typescript/bin/tsc -b tsconfig.build.json
node benchmarks/euler740.mjs
node benchmarks/euler740.mjs 5 reference
PROFILE=/tmp/euler740.cpuprofile DIAGNOSTICS=1 node benchmarks/euler740.mjs 40
RANK_SOURCE=benchmarks/fixtures/euler740-original.ra node benchmarks/euler740.mjs
node benchmarks/experiments/euler740-broadcast.mjs +
TYPED=1 node benchmarks/experiments/euler740-broadcast.mjs min
node benchmarks/euler707-arrays.mjs lane
```

`RANK_ROOT` selects another built snapshot. Keep profiling and diagnostics out
of primary timing runs. The intermediate hoisted/deferred source variants are
retained under `experiments/euler740-*.ra`.
