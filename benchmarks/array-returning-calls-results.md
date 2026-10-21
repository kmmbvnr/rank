# Array-returning calls in compiled loops

Measured on 2026-10-21, Apple M5, Node v24.15.0. Baseline: `5cc5b310`;
candidate: `3e8f2d1c`. The baseline was built in a separate detached worktree
at `5cc5b310`, with its own workspace dependencies and outputs. Each comparison
uses three fresh processes per runtime,
executed sequentially with alternating order. No builds or tests from this
task ran during either timing series. Other host activity was not controlled.

The workload calls a function 20,000 times. Each call creates and returns a
23-cell integer vector, updating every cell with exact modular arithmetic.
The caller passes that vector into the next invocation. A separate native
JavaScript BigInt calculation checks every final cell and the sum `15573568916`.
The oracle runs after the execution timer.

| Default runtime | Median execution | Median CPU | Median process | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 0.963 s | 1.825 s | 1.263 s | 322.4 MiB |
| Candidate | 0.480 s | 0.760 s | 0.801 s | 231.8 MiB |

In this series execution takes 50% less time (2.01x faster), CPU use falls by
58%, and median process peak RSS falls by 28%. RSS includes imports and oracle
verification, not just the measured execution interval. These are local
observations, not portable timing guarantees.

A separate series enabled `onIntegerLoopExecuted` to count compiled-region
entries. That hook disables Number-loop speculation, so its timings must not
be mixed with the default-runtime table. It measured 0.753 s versus 0.431 s
execution and 325.7 MiB versus 232.2 MiB peak RSS. Region entries changed from
20,000 inner-loop invocations to one outer-loop entry. The callee still runs
20,000 times through its existing typed function kernel; its mathematical
loops are not removed.

## Changes and limits

The first commit, `1d651bbe`, separates shared loop lowering from exact/Number
runtime preparation and uses the plan's field types in compilation state.
Semantic checks remain shared; lowering still runs for each representation.
This is an incremental refactor, not a new universal intermediate language.

The second commit admits existing proven array-returning function kernels at
loop call sites. Array literals, aliases and call results share one binding
lowering helper. Ordinary binding checks still validate the result before
publishing it. Supported results retain their element domain and rank;
integer, boolean and text arrays use the existing feature gates.

Caller regions with indexed writes remain interpreted when they contain an
array-returning call. Such a call can retain an alias after entry COW has run;
allowing later raw stores would need ownership preparation at each store.
Writes inside the callee retain the function kernel's existing COW checks.
Scalar arithmetic, min/max inference, lazy array arguments and other unproved
calls keep their existing compilation or fallback paths.

## Euler 324 and the modular backend decision

All six full-scale Euler runs still returned `96972774`. Execution medians were
9.201 s on the baseline and 8.503 s on the candidate (ranges 8.82–9.70 s and
8.48–8.81 s). This checks correctness and shows no observed regression; it does
not attribute an Euler speedup to the new call boundary. These are separate
observations from the earlier #357 timing series, not a portable timing gate.

A separate candidate profile still records 89,804 compiled inner-loop entries,
89,793 Number overflows and 20 dependency validations. The outer loop does not
enter the new call path: its helper also needs captured scalar values and
additional body/return forms accepted by the function proof.

Generated code accounts for 34.7% of profile self samples, including arithmetic,
loop control and publication. It does not isolate modular multiplication cost.
Loop entry, storage access, binding checks and GC remain visible. This evidence
does not justify another modular backend or unchecked Number arithmetic.
Further work should extend the existing proof/call boundary in small steps and
profile that result before adding an arithmetic backend.

## Verification

- TypeScript project build and semantic-boundary/application-form checks pass.
- Before and after the first refactor, the same 408 focused tests pass.
- The ordinary interpreter suite passes: 249 files, 4,847 tests. The final
  array-call suite passes all 12 cases, including one added after that run.
- Array-call tests compare values, bindings, partial errors and locations with
  compilation disabled. They cover COW, BigInt loop control, empty loops,
  function rebinding, returned matrices and direct returns from loops.
- Exhaustive corpus audits and the Nurikabe suite were excluded from the
  ordinary interpreter run. Selected type and differential audits pass for
  CSES array description and Euler 76, 77, 78 and 324: 10 selected test cases.

```sh
npm run langium:generate
npx tsc -b tsconfig.build.json
node benchmarks/array-returning-calls.mjs --baseline=/path/to/baseline/packages/interpreter/out/index.js
node benchmarks/array-returning-calls.mjs --baseline=/path/to/baseline/packages/interpreter/out/index.js --entries
node --cpu-prof benchmarks/modular-recurrence.mjs --worker=stored --diagnostics
```

The benchmark accepts `--n=500 --trials=1` for a smoke run and `--runtime=...`
for a separately built candidate runtime. It never builds another checkout.

- [Default-runtime samples](baselines/2026-10-21-array-returning-calls.jsonl)
- [Separate entry-hook samples](baselines/2026-10-21-array-returning-calls-entries.jsonl)
- [Euler comparison samples](baselines/2026-10-21-loop-backends-euler.jsonl)
- [Separate profile summary and diagnostics](baselines/2026-10-21-loop-backends-profile.json)
