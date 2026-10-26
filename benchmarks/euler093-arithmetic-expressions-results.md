# Euler 093: native tensor completion

The algorithm and all three tests in `demos/euler/093_arithmeticexpr_test.ra`
are unchanged. Each fixture test executes the full main; the second and third
then inspect a four-digit or two-digit subset already present in its index.
The full answer remains `1258`, with a consecutive run of `51`.

## Diagnosis

The main already uses subset dynamic programming rather than independently
expanding all expression trees for every digit permutation. It stores each
subset's reachable real values once, splits it into two nonempty halves and
combines their value sets. An independent JavaScript scalar implementation
counts 131592 candidate splits, 1875 accepted unordered partitions and 324578
arithmetic results before deduplication. It agrees on every one of the 385
stored value sets, including the ten singleton seeds.

Both Rank engines previously took approximately the same time. Loop compilation
rejects the array-valued seed loop and the main's materialization expressions.
The outer/reshape stages also ran through generic per-cell readers. This is
primarily runtime overhead on a modest dynamic-programming workload, with a
separate factor of three from repeated default execution in the fixture.
The historical issue's concurrent audit (19.6 s reference / 18.3 s compiled for
the fixture) is not comparable with these serial measurements.

## Implementation

Native tensor recipes can now use the existing compiler's copy emitter at the
ordinary completion boundary. `materializeValue` and `reshapeWithDimensions`
consume checked native arithmetic directly into typed storage. Deferred outer
arithmetic and its scalar operation are compiled together, including real
addition, multiplication, both subtraction directions and division.
The reshape changes metadata on the completed storage instead of collecting a
boxed cell array and reconstructing it. Completion still occurs at the same
`=` or reshape demand. Nothing moves across an earlier ordinary binding.

The implementation shares the existing native reduction lowering, guards,
operator signatures, code cache, validators and interruption checkpoints.
Unsupported host readers and callbacks retain ordinary traversal. Stored
arrays are boundaries; their prior producer is never reopened. Unused plans
are not evaluated. Packed boolean completion retains priority over scalar
compilation. This does not compile the whole index-building loop or fuse all
subset partitions into one kernel.

Two generic consumers (`isMask` and `rankOneValues`) now use `readArrayItem`
instead of exposing `.items` to read a single element. Previously a
`first index where` probe unpacked both complete 7000-element boolean buffers
for each four-digit set, even when the search stopped near the beginning.

Separate diagnostics of the main show:

| Counter | Before | After |
| --- | ---: | ---: |
| Compiled tensor executions | 0 | 11121 |
| Generic derived-cell computations | 3528481 | 652626 |
| Typed-buffer unpack events | 420 | 0 |
| Cells in those unpacks | 2940000 | 0 |
| Element-type scanned cells | 100320 | 424898 |
| Compiled loops | 0 | 0 |

The increase in type-proof work and many small native demands limits the
speedup. These counters are not timings or counts of all allocated cells.

## Reproduction and validation

Build first, then run without concurrent tests or profilers:

```sh
npx tsc -b tsconfig.build.json packages/interpreter/tsconfig.test.json
node benchmarks/euler-arithmetic-expressions.mjs --samples=5 \
  --baseline-runtime=/path/to/old/out/index.js
```

`--engine=reference` selects the interpreter; `--diagnostics=true` adds counters
and should be run separately from timing samples. Each child has a 60-second
process deadline. Samples alternate workload/version order. The measured
interval includes parsing and complete execution. Peak RSS is the process
high-water mark sampled before independent oracle validation, not retained
array memory. The main compares all reachable-value sets with the independent
scalar implementation outside the timer. The fixture checks all three tests
and their full-size output in both versions.

The baseline is the built interpreter at `56c97fa2`; language/common dependencies
and both demo sources are shared with the new runtime. Raw results retain
source and changed runtime-artifact hashes. This comparison changes only the
runtime, with no changes to input sizes, algorithm, tests, timeouts or lanes.

## Controlled compiled-engine comparison

Apple M5 / Node v24.15.0; five samples per workload and version, each in a
fresh process. These measurements were taken after the test processes finished.

| Workload | Before, median s | After, median s | Speedup | Before peak RSS MiB | After peak RSS MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Main | 1.302 | 1.139 | 1.14x | 454.6 | 491.1 |
| Fixture, all three full runs | 3.549 | 2.877 | 1.23x | 544.1 | 686.3 |

Every timing sample improves on its paired baseline. Main time ranges are
1.241–1.368 s before and 1.101–1.178 s after; fixture ranges are 3.436–3.607 s
and 2.837–2.922 s. These are approximately 12.5% and 18.9% reductions in time,
respectively. The source hashes match between versions.

Peak RSS **increases**, by about 8% for the main and 26% for the fixture at the
sample medians. Eliminating boolean buffer unpacks and generic cell readers is
not evidence of smaller retained memory: compiler metadata, typed allocations
and garbage-collection timing also contribute to process high-water usage.
This change is a measured speed improvement, not a process-memory improvement.

[Raw compiled-engine measurements](baselines/2026-10-26-euler093-native-completion.json)
include all individual samples and hashes of the six changed runtime artifacts.

The separately measured reference engine (three fresh-process samples per
version/workload) changes from 1.295 to 1.247 s for the main and 3.489 to 3.373 s
for the fixture. Native tensor compilation is disabled there; these smaller
differences include the generic boolean-reader improvement and measurement
variation. [Raw reference measurements](baselines/2026-10-26-euler093-reference.json).
The compiled-results artifact also retains separate before/after diagnostic
runs; their instrumented timings are not included in the timing medians.

## Verification

- TypeScript build and interpreter test typecheck pass.
- All 8384 tests in 368 ordinary interpreter test files pass. The selection
  excludes the exhaustive type/differential corpora and Nurikabe.
- Scoped type and differential audits of both Euler 093 files pass in both
  engines, retaining all three full-size fixture tests.
- Fourteen new tests cover native real outer completion, unused plans,
  mutable completed snapshots, reshape failures with earlier stores retained,
  host-reader order and prefix-only boolean searches without buffer unpacking.
- Existing plan completion tests retain their assertions about stored results
  and producer boundaries. Kernel-count expectations now include the new
  completion kernels; final reductions still do not reopen earlier producers.
- The final focused check of native completion, packed booleans and tensor
  plan composition passes all 183 tests after preserving packed-kernel priority.
- Semantic boundary and application-form checks pass. No exclusion, timeout,
  scheduling or fixture changes were made.
