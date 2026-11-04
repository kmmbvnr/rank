# Execution boundaries: reference preparation and scalar call facts

Issue: #512. Baseline: `9c86a26230476c91774cb19fbdcea4f90ec6f293`.
Candidate: `797a4391de9136e55490bc50a010cacdd0473a06`.
Both include the Euler 391 integer-publication changes from main.

## Scope and existing machinery

The audit found reusable analysis already in `prepareFunction`, `FunctionFrames`,
`FunctionEffects`, `ScalarFunctionProof` and `LocalFrame`. Signatures, slot layouts,
borrow candidates and domain-specific scalar proofs already have caches; live
binding identities guard helper-dependent borrowing and native calls. Argument
contracts still run per call. Tail-call frame reset already exists, but exposed
maps, escaping closures and suspended execution prevent indiscriminate frame reuse.

The implementation carries `CompiledCallee.effects.privateStateSafe` from existing
scalar facts to Number-loop admission. Scalar arguments/results, no captured
context/domains, no observable writes or container access, and no further helper/data
dependencies establish the supported case. Native calls retain builtin identity,
effect and host-override guards. The same fact allows a helper beside private
containers and beside local array replacement. A safe local scalar binding inside
the helper no longer changes admission. No workload names or AST-shape exceptions
were added to `prepareNumberLoop`.

Range safety still uses checked Number results and exact replay. This is not a new
interprocedural range analysis. Captured helpers, reference arguments, escaped
array results and helper chains need broader ownership/escape summaries. Mixed
BigInt call results remain a representation boundary. Rebound arrays now distinguish
`rebound-call-state-proof`, `rebound-wide-value-proof` and `rebound-layout-proof`.
These are remaining proof boundaries, not claims that those programs are invalid.

Reference execution now caches the syntax-name list used to determine return
I/O demand. It resolves current bindings on every call; it never caches effects,
values or frames. Reference statement control remains independent of optimizing
loop transformations. The existing admission comment explicitly asks maintainers
to identify a missing general proof before adding another exception.

## Profiling evidence

Separate CPU and 4 KiB heap-sampling profiles execute 100,000 reference helper calls.
The saved `*-profile.txt` files contain the hottest CPU nodes and allocation sites;
`execution-boundary-profile.mjs` reproduces full Inspector CPU/heap JSON files.
The baseline Mac profile includes AST stream construction and traversal among the
largest allocation sites (71 MB and 36 MB at stream nodes, 53 MB at
`TreeStreamImpl.includeRoot`, 31 MB at `streamAst`). They disappear from the
candidate's leading allocation sites. Frame creation and invocation allocation
remain prominent. This evidence motivated syntax preparation; it does not show
that frame pools, dispatch rewrites or elimination of contracts are safe or useful.
Profiled elapsed times include instrumentation and are not the speed evidence below.

## Measurement method

Node 24.15.0 on Apple M5 and Intel i7-10750H. Three samples per case, engine and
instrumentation mode, each in a fresh process; baseline/candidate order alternates.
The seven cases produce 168 observations per host, all with exact result assertions.
Parsing/process startup are excluded from elapsed execution; cold preparation and
compilation are included. `scalarEntryCompilation: false` isolates loop admission.
This task's builds and tests finished before each final timing series.

Timing and RSS use diagnostics/profiling off. Allocations use separate runs with
RuntimeDiagnostics and V8 heap sampling at 32 KiB, including collected objects.
They estimate cumulative JS heap allocation, exclude external ArrayBuffer storage,
and are not retained memory. RSS is the entire process high-water mark, including
startup/parsing/final GC. Raw files also contain live-runtime post-GC heap and
ArrayBuffer retention and instrumented timings. Three samples establish these
examples, not a statistical guarantee for unrelated programs.

- `return-expression`: 100,000 calls with `return B - X`.
- `return-name`: equivalent `C = B - X; return C`, controlling the existing name-return shortcut.
- `inline-index`, `helper-index`, `binding-index`: 20,000 index updates, respectively
  inline arithmetic, a scalar helper, and a helper with a local scalar binding.
- `rebound-inline`, `rebound-helper`: 2,000 replacements of a 128-cell array,
  retaining an outside alias and accumulating reads from the new array.

## Execution time

Medians in milliseconds, diagnostics and profiling off.

| Host | Case | Engine | Baseline | Candidate | Ratio |
| --- | --- | --- | ---: | ---: | ---: |
| mac | return-expression | reference | 588.43 | 495.61 | 0.842 |
| mac | return-expression | compiled | 13.56 | 12.95 | 0.955 |
| mac | return-name | reference | 485.90 | 489.98 | 1.008 |
| mac | return-name | compiled | 13.26 | 13.02 | 0.981 |
| mac | inline-index | reference | 32.08 | 30.97 | 0.966 |
| mac | inline-index | compiled | 11.73 | 11.48 | 0.978 |
| mac | helper-index | reference | 86.18 | 65.93 | 0.765 |
| mac | helper-index | compiled | 16.29 | 14.83 | 0.910 |
| mac | binding-index | reference | 111.20 | 109.78 | 0.987 |
| mac | binding-index | compiled | 16.63 | 14.56 | 0.876 |
| mac | rebound-inline | reference | 20.27 | 20.91 | 1.032 |
| mac | rebound-inline | compiled | 15.04 | 14.35 | 0.954 |
| mac | rebound-helper | reference | 35.72 | 36.02 | 1.008 |
| mac | rebound-helper | compiled | 25.05 | 17.60 | 0.702 |
| intel | return-expression | reference | 2224.77 | 1825.16 | 0.820 |
| intel | return-expression | compiled | 29.52 | 29.14 | 0.987 |
| intel | return-name | reference | 1784.03 | 1788.43 | 1.002 |
| intel | return-name | compiled | 31.20 | 29.20 | 0.936 |
| intel | inline-index | reference | 98.30 | 102.09 | 1.039 |
| intel | inline-index | compiled | 25.30 | 27.35 | 1.081 |
| intel | helper-index | reference | 316.93 | 222.75 | 0.703 |
| intel | helper-index | compiled | 38.61 | 32.47 | 0.841 |
| intel | binding-index | reference | 404.19 | 428.02 | 1.059 |
| intel | binding-index | compiled | 41.48 | 32.45 | 0.782 |
| intel | rebound-inline | reference | 73.51 | 71.52 | 0.973 |
| intel | rebound-inline | compiled | 33.54 | 33.23 | 0.991 |
| intel | rebound-helper | reference | 135.11 | 133.23 | 0.986 |
| intel | rebound-helper | compiled | 80.23 | 41.73 | 0.520 |

## Memory

Median cumulative sampled JS allocation and whole-process peak RSS, in MiB.

| Host | Case | Engine | Allocation before → after | RSS before → after |
| --- | --- | --- | ---: | ---: |
| mac | return-expression | reference | 1537.64 → 1238.43 | 467.81 → 429.91 |
| mac | return-expression | compiled | 4.23 → 4.18 | 144.00 → 168.89 |
| mac | return-name | reference | 1238.07 → 1234.87 | 430.92 → 430.61 |
| mac | return-name | compiled | 4.33 → 4.83 | 156.23 → 171.47 |
| mac | inline-index | reference | 70.79 → 72.96 | 176.05 → 174.16 |
| mac | inline-index | compiled | 4.02 → 3.42 | 157.97 → 172.11 |
| mac | helper-index | reference | 237.29 → 176.16 | 191.73 → 189.34 |
| mac | helper-index | compiled | 14.45 → 4.93 | 144.36 → 171.67 |
| mac | binding-index | reference | 209.64 → 210.41 | 233.59 → 237.61 |
| mac | binding-index | compiled | 14.83 → 4.91 | 144.09 → 173.98 |
| mac | rebound-inline | reference | 20.98 → 21.91 | 160.45 → 176.25 |
| mac | rebound-inline | compiled | 3.07 → 3.22 | 158.28 → 175.33 |
| mac | rebound-helper | reference | 41.24 → 41.13 | 161.84 → 177.83 |
| mac | rebound-helper | compiled | 21.24 → 3.81 | 160.78 → 173.59 |
| intel | return-expression | reference | 1541.82 → 1234.59 | 401.85 → 391.79 |
| intel | return-expression | compiled | 4.32 → 4.27 | 140.83 → 140.39 |
| intel | return-name | reference | 1240.14 → 1231.86 | 393.75 → 393.26 |
| intel | return-name | compiled | 4.51 → 4.27 | 140.83 → 142.35 |
| intel | inline-index | reference | 71.58 → 70.14 | 159.14 → 160.12 |
| intel | inline-index | compiled | 3.62 → 3.99 | 133.40 → 142.92 |
| intel | helper-index | reference | 237.76 → 177.55 | 178.69 → 175.80 |
| intel | helper-index | compiled | 13.76 → 5.05 | 142.94 → 133.24 |
| intel | binding-index | reference | 210.46 → 211.37 | 214.23 → 212.84 |
| intel | binding-index | compiled | 14.31 → 5.17 | 131.55 → 141.29 |
| intel | rebound-inline | reference | 20.84 → 21.51 | 143.28 → 143.66 |
| intel | rebound-inline | compiled | 3.43 → 3.49 | 141.68 → 141.70 |
| intel | rebound-helper | reference | 39.44 → 40.68 | 146.90 → 147.05 |
| intel | rebound-helper | compiled | 20.55 → 3.61 | 134.04 → 141.32 |

## Admission evidence

Every instrumented compiled sample on both hosts has these outcomes:

| Case | Baseline Number loops | Candidate Number loops | Removed rejection |
| --- | ---: | ---: | --- |
| inline-index | 1 | 1 | none (control) |
| helper-index | 0 | 1 | call-private-state-proof |
| binding-index | 0 | 1 | call-private-state-proof |
| rebound-inline | 1 | 1 | none (control) |
| rebound-helper | 0 | 1 | rebound-input-proof |

## Source identity

Both hosts produced the same interpreter source hashes (sorted relative `.ts` paths, NUL, file bytes):

- baseline-off: `7b6cc185d77a1863f19cb6a39631c73523013a1d0e0956a2a6e15d2435fa4036`
- candidate-off: `4e015444c97991ec890edd52825eb4032271cfc9d8b7442777dd707643d6e341`

## Interpretation and limits

Reference expression returns take 16–18% less time and allocate about 19–20% less
sampled JS heap on both hosts. The direct helper/index example takes 24–30% less
time with about 25–26% less allocation. The name-return and local-binding reference
controls do not benefit from the syntax cache; Intel's binding-index control is
5.9% slower in this series. Do not extrapolate a universal reference speedup.

Compiled helper/index variants take 9–22% less time and allocate about 63–67% less
sampled JS heap. Array replacement with a helper takes 30% less time on Mac and
48% less on Intel, with about 82% less sampled allocation. The inline controls
already admitted Number loops. Intel's compiled inline-index control is 8.1% slower
(25.30 → 27.35 ms); this series does not establish an improvement for that case.
Cold preparation is a substantial part of these short compiled examples.

Lower cumulative allocation does not imply lower peak process memory. Mac's
compiled helper cases have higher RSS despite lower JS allocation, and several
controls also rise. The reference expression case reduces RSS on both hosts;
other RSS results are mixed. No general peak-memory reduction is claimed.

Further work should first measure the remaining frame/invocation allocation and
then prove which frames cannot escape or suspend. Captured immutable scalar
summaries and composition through helper chains are useful possible extensions,
but require guarded facts about dependencies and visibility; neither blanket
frame pooling nor another admission exception follows from these results.

## Verification and reproduction

TypeScript project builds passed on both hosts. The same 602 focused tests across
19 files passed on Mac and Intel, covering helper extraction/local bindings, native
and helper rebinding, alias visibility, overflow replay, errors, cancellation,
closures, contracts, escaped plans and the integrated integer publication changes.
Semantic-boundary checks passed (11 tests, 65 owners); application-form checks
passed. Full suites and exhaustive type/differential/demo audits were not run.

From `packages/interpreter`:

```sh
node ../../node_modules/vitest/vitest.mjs run \
  --config ./scripts/type-audit.config.mjs --maxWorkers 4 \
  test/number-loop-index.test.ts test/number-loop-vectors.test.ts \
  test/number-loop-fenwick.test.ts test/number-loop-aliases.test.ts \
  test/number-loop-polling.test.ts test/return-preparation.test.ts \
  test/plan-effects.test.ts test/scalar-plans.test.ts \
  test/function-scope-helpers.test.ts test/parameter-bindings.test.ts \
  test/function-binding.test.ts test/array-binding-contracts.test.ts \
  test/block-scope.test.ts test/scalar-function-proof.test.ts \
  test/tail-calls.test.ts test/scalar-function-domains.test.ts \
  test/euler391.test.ts test/integer32-storage.test.ts test/tuples.test.ts
```

Build separate checkouts of the baseline and candidate with their locked
dependencies, generated language and `tsc -b tsconfig.build.json`. From candidate:

```sh
node benchmarks/execution-boundaries.mjs \
  --baseline=/path/to/baseline --samples=3 > results.json
node benchmarks/execution-boundary-profile.mjs \
  /path/to/baseline /tmp/baseline-profile
node benchmarks/execution-boundary-profile.mjs \
  /path/to/candidate /tmp/candidate-profile
```

Raw observations: [Mac](results/execution-boundaries/mac.json),
[Intel](results/execution-boundaries/intel.json).
Profile summaries: [Mac baseline](results/execution-boundaries/mac-baseline-profile.txt),
[Mac candidate](results/execution-boundaries/mac-candidate-profile.txt),
[Intel baseline](results/execution-boundaries/intel-baseline-profile.txt),
[Intel candidate](results/execution-boundaries/intel-candidate-profile.txt).
