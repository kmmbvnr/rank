# Euler 221 investigation

Revision: `46308359329fe2f4154a9db0da350ca3818af278`. Selected from the live
#447 inventory: both 221 files remain unfinished, before 223. The investigation below predates delivery. Shipping now uses direct divisor
iteration and extends copy admission to short root vector loops; the final
comparison and verification are recorded at the end. Execution lanes are unchanged.

## Diagnosis

The existing divisor parameterization is adequate. Most elapsed time is Rank
execution/allocation overhead for many tiny arrays, not factoring or sorting.
For each of 80,000 values of P the original materializes all divisors, makes a
mask and filtered array, and constructs deferred quotient/product stages before
a slice write. The average retained divisor count is only 5.85.

The original outer loop does not compile: the first rejection is
`loop:unsupported-node:MaterializeExpression`. Diagnostics report zero compiled
loops, 160,000 compiled tensors, 80,000 Number tensors, 80,000 mask
materializations, and 80,000 tensor-map preparations. There are another 80,000
`tensor:output-shape` fallbacks. These counters describe preparations/executions,
not 160,000 distinct generated JavaScript functions.

One separate CPU profile collected 7,166 samples: GC accounts for 1,348 self
samples (18.8%), tensor-kernel.js for 905 (12.6%). Array contracts, tensor maps,
derived arrays and plan construction are also prominent. Factorization and
primality have 227 combined self samples; that is not their full inclusive cost.
A direct JS control using the same Factorizer, but simpler divisor/value
handling, took 311 ms to generate and 72 ms to sort all candidates in one run.
This is supporting evidence, not a precise measurement of interpreter overhead.

## Controlled measurements

macOS arm64, Node v24.15.0. Serial fresh processes, medians of three samples per
row except explicitly noted. Parsing included; module import excluded. RSS is
whole-process highwater and varies with GC. Historical concurrent issue timings
are not used as a baseline. All completed full runs return `1884161251122450`.

| Source | Engine/runtime | Time, s | RSS, MiB |
| --- | --- | ---: | ---: |
| Original | compiled, current | 8.719 | 1108.8 |
| Original | reference, current | 6.592 | 908.3 |
| Stream divisors, scalar writes | compiled, current | 1.194 | 343.6 |
| Stream divisors, scalar writes | reference, current | 1.108 | 334.4 |
| Materialized divisors, scalar writes | compiled, current | stopped after 90 s | not retained |
| Materialized divisors, scalar writes | reference, current | 1.352 (one run) | 400.7 |
| Same materialized source | compiled, diagnostic admission patch | 1.263 | 400.5 |

Streaming is about 7.30x faster compiled and 5.95x reference, with roughly
69% / 63% lower median RSS. It retains the same mathematical search and full
sort. It stops the ascending divisor iterator at the first divisor above P;
the current native divisor iterator still constructs and sorts its own divisor
list internally. This does not eliminate all divisor materialization.

Changing only `E'`/`Vals'` to ordinary `=` gave 4.745 s compiled / 4.726 s reference
(one run each). It removes some deferred-stage overhead but is less effective.
This is a source-level evaluation choice, not evidence that deferred bindings
should silently become eager.

## Independent Number admission problem

The materialized-divisor scalar variant exposes a separate compiler defect.
`prepareNumberLoop` counts destination-copy cost only under `!plan.iteration`.
An array iteration bypasses that guard. The inner loop processes only a handful
of divisors but copies the entire `12 * Limit` output buffer on each invocation.
It also scans/converts numeric storage and publishes changed cells afterward.
The existing 64/262144 copy policy does not protect this path.

At Limit=1000 the diagnostic profile run executes 1000 Number loops in 342 ms;
at Limit=4000 it executes 4000 in 3474 ms. Those timings include profiling and
are not controlled benchmark medians. Copy-probe counters remain zero. The
full compiled variant exceeded an external 90-second deadline and was killed.

For diagnosis only, a scratch copy of the built runtime removes the
`if (!plan.iteration)` condition around destination-size counting. With no work
feedback for this iterator, large destinations decline Number mode. The exact
backend then runs 80,000 compiled loops, zero Number loops, and finishes in
1.263 s. This proves the problem is admission/copying, not insufficient BigInt
speed. The original program has no such inner loop and is not fixed by that
change alone.

This conservative prototype is not a production policy: rejecting all iterator
writes above 64 cells could lose useful Number execution on longer loops.
A general repair should consider the iteration's expected work versus copied
storage, preserve overflow replay, and benchmark both short and long iterator
loops. The existing thresholds were not retuned here.

There is also a broader compiler opportunity: the streaming divisor sequence
is not a supported integer-loop header. Compiling it would require guarded,
ordered native sequence iteration and early break, without eagerly running
unused plans or changing error timing. Merely removing a rejection is unsafe.

Intermediate candidates can exceed both Number's exact range and signed 64-bit
storage (P=80000, d=1 yields about 4.096e19). The final selected answer being
safe does not justify forcing the whole calculation into unchecked Number mode.

## Correctness and scope

- Original and streaming fixtures pass both existing test blocks in both engines.
- 96 independent checks compare the entire sorted output, not just one selected
  value, for 12 limits from 1 to 250, four source variants and both engines.
  The oracle directly tests every integer divisor d <= p; it does not use
  Factorizer or the divisor iterator. The same 96 checks pass the scratch runtime.
- A native full enumeration found 467,861 candidates and 467,861 distinct values
  in this bounded search. Original and unique sorted selections agree.
- The fixture repeats the full default once; its other block is tiny. New
  one-run fixture checks are retained in the raw artifact; no tests were removed.
- At the investigation stage, no ordinary/full interpreter suite was run because shipping code was unchanged.
  No Intel benchmark was performed. Prototype results do not establish general
  runtime regression safety.

Recommendation: use direct divisor iteration/scalar writes in the demo and fix
Number copy admission generally. A replacement number-theory algorithm is not
needed to obtain the demonstrated speedup. Compiler support for sequence
consumers is a separate, broader improvement.

## Reproduction

After building, from the repository root (use `--runtime=/abs/out/index.js` when
running against an isolated build):

```sh
node benchmarks/euler221-alexandrian.mjs
node benchmarks/euler221-alexandrian.mjs --reference
node benchmarks/euler221-alexandrian.mjs --source=benchmarks/experiments/euler221-stream.ra
node benchmarks/euler221-alexandrian.mjs --source=benchmarks/experiments/euler221-stream.ra --reference
node benchmarks/euler221-alexandrian.mjs --source=benchmarks/experiments/euler221-stream.ra --fixture
node benchmarks/experiments/euler221-oracle.mjs
```

Impose process deadlines externally, especially for `euler221-stream-array.ra`.
Raw data: `baselines/2026-10-28-euler221-investigation.json`.


## Delivery comparison and selected policy

The shipping demo now uses direct ordered divisor consumption. Its algorithm,
default N=150000 and Limit=80000, full golden answer and fixture selections are
preserved. The compiler repair covers root vector loops; range loops retain
their existing admission. The 64-cell fast path and 262144-cell probe cap are
unchanged. Definitely fresh local arrays remain exempt from copying costs.

Two policies were compared with the original runtime in 63 serial fresh
processes: seven workloads, three policies, three samples. The conservative
prototype simply applies the condition-loop check to every iterator without
adding iterator feedback. The selected implementation shares feedback with
root vector loops and recognizes a full plain named-array pass with no early
control transfer when its length covers total copied destination storage.
This known full pass retains Number even above the bounded-probe cap; short or
unknown traversals retain the bounded probe/exact-work policy.

| Copy workload | Before, ms | Conservative, ms | Selected, ms |
| --- | ---: | ---: | ---: |
| short | 138.48 | 112.35 | 115.47 |
| large-short | 225.96 | 128.15 | 124.49 |
| wide-short | 525.69 | 109.84 | 116.62 |
| large-wide-short | 1827.00 | 118.21 | 122.67 |
| full | 105.72 | 166.52 | 101.60 |
| large-full | 108.84 | 357.93 | 111.44 |
| phase | 223.68 | 223.47 | 217.63 |

All policies use identical source per workload and verify exact answers.
`wide` initializes values beyond Int32, exercising the scanning/conversion path
exposed by Euler 221. `full` is a complete vector pass; `phase` switches from
short vectors to vectors with enough nested work to amortize copying.
The selected policy avoids the conservative policy's 3.29x long-pass slowdown.

Final Euler 221 cohorts below use the shipping runtime for both captured
original and new source. Three alternating fresh processes per source/engine,
with separate single fixture confirmations. Runtime imports are excluded;
parsing, compilation/preparation and execution are included.

| Source | Engine | Time, s | RSS, MiB |
| --- | --- | ---: | ---: |
| Original | compiled | 8.865 | 1129.6 |
| Original | reference | 6.438 | 696.6 |
| Shipping | compiled | 1.213 | 343.2 |
| Shipping | reference | 1.134 | 334.6 |
| Materialized scalar variant | compiled | 1.286 | 410.9 |

The shipping demo improves about **7.31x compiled / 5.68x reference**, with
median RSS about **70% / 52% lower** in this final cohort. Source changes remove
the per-P mask/tensor pipeline; native divisor enumeration still materializes
its own internal list. The materialized scalar alternative now also completes
in about 1.29 s instead of exceeding 90 s. It is retained as a compiler control,
not selected for the demo.

### Other full-demo controls

Three fresh processes per version per case. Baseline and candidate were placed
in sibling directories with equivalent package metadata and dependency access.
All runtime JavaScript modules except the two changed modules byte-match.
No same-host tests/builds/profilers overlapped these timings. Every golden
assertion passed. These are Mac controls; Intel was not measured for this change.

| Euler | Before, ms | Selected, ms |
| --- | ---: | ---: |
| 185 | 576.24 | 577.26 |
| 170 | 546.44 | 536.86 |
| 179 | 652.17 | 558.16 |
| 23 | 376.21 | 379.13 |
| 125 | 188.84 | 195.49 |
| 166 | 1065.30 | 1060.52 |
| 177 | 1366.71 | 1367.68 |
| 60 | 2610.56 | 2611.12 |
| 88 | 780.93 | 791.16 |
| 186 | 253.97 | 254.06 |
| 211 | 4897.73 | 4977.93 |
| 213 | 1639.30 | 1619.29 |
| 214 | 1319.98 | 1305.74 |
| 216 | 10394.46 | 10402.64 |
| 154 | 8887.23 | 8900.22 |

These controls do not show a material general slowdown. Euler 179 has bimodal
samples and overlapping ranges; its apparent median improvement is not claimed
as an optimization. The small positive deltas on other cases likewise do not
establish regressions beyond this sample cohort.

An initial comparison appeared to slow Euler 088 by 22%, but used a candidate
in a different directory layout. At the same runtime path, alternating old/new
modules gave 962.243 / 964.017 ms medians. A byte-identical candidate snapshot in
a matched sibling directory restored about 0.78 s. All 14 primary controls were
then rerun with matched layouts; full 154 was added separately. Raw initial,
hybrid, same-path and matched results are retained without claiming a deeper
cause for this Node/runtime-layout sensitivity.

Raw delivery data: `baselines/2026-10-28-euler221-delivery.json`.


### Final verification

- TypeScript build and interpreter test typecheck pass.
- 227 focused tests pass, including six new vector-copy regression tests for
  repeated short inputs, long full passes, early break, nested-work promotion,
  overflow/error replay and behavior on either side of the bounded-probe cap.
- 9,178 ordinary interpreter tests across 404 files pass with two workers
  (163.07 s); exhaustive types, full differential corpus and Nurikabe are
  excluded from this ordinary run.
- Two scoped type audits and two scoped differential audits pass, covering both
  Euler 221 files and full default assertions. Both fixture blocks also pass in
  separate compiled/reference confirmations.
- 120 independent direct-divisibility oracle executions compare entire sorted
  results for five variants, twelve limits and both engines.
- Semantic-source/catalogue checks, 65 semantic-boundary owners and application
  form checks pass. Execution exclusions/timeouts are unchanged.

Reproduce additional controls after building:

```sh
node benchmarks/euler221-alexandrian.mjs --original
node benchmarks/experiments/euler221-copy-admission.mjs --case=large-wide-short --runtime=/abs/out/index.js
node benchmarks/experiments/euler221-copy-admission.mjs --case=large-full --runtime=/abs/out/index.js --diagnostic
node benchmarks/experiments/euler221-native.mjs /abs/out/index.js
```

Run each timing sample in a fresh process and compare runtime snapshots from
matched directory layouts. The native control uses Factorizer and is separate
from the direct-divisibility correctness oracle.
