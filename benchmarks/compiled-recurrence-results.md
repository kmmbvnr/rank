# Captures and array operations in linked recurrence calls

Measured on 2026-10-21, Apple M5, Node v24.15.0. Baseline: `0db98688`;
candidate: `2351354c`, including the four implementation commits
`88d0013a`, `76dc2694`, `de2087b7`, and `9e6de470`.
Each revision has a separate worktree, workspace dependencies, and compiled
outputs. Three fresh processes per revision ran sequentially, alternating
revision order. No builds or tests from this task ran during this series.
Other host activity was not controlled. Parsing and setup are timed; process
RSS also includes runtime imports. Diagnostic runs are separate.

Both revisions execute the unchanged stored-array Euler 324 demo with
`Exp = 5 * 10 ** 9999`. Every run checks the answer `96972774` and records the
source hash. Finite checkpoints also return `96149360`, `24806056`, and
`30808124` for exponents 5, 500, and 500000.

| Runtime | Median execution | Median CPU | Median process | Median peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 13.444 s | 15.440 s | 13.876 s | 461.7 MiB |
| Candidate | 14.056 s | 15.148 s | 14.484 s | 437.5 MiB |

This is broader compilation coverage, not a demonstrated speedup: elapsed
execution is 4.6% higher, CPU is 1.9% lower, and process peak RSS is 5.2% lower
in this small local series. The remaining BigInt arithmetic and array ownership
checks still cost time. These observations are not portable performance gates.

The hot binary loop now enters the compiled backend once. Its `combine` calls
use existing function kernels, including the inner polynomial loops. Those
mathematical iterations still execute. The enclosing `recurrence` function
itself remains interpreted because its `odd` expression is outside the scalar
function proof; this does not prevent its hot loop from compiling.

Separate diagnostics record 89,804 compiled-loop entries and 89,793 Number
overflow replays on the baseline, versus one entry and zero Number attempts or
replays on the candidate.

## Scope and guards

Scalar captures specialize by domain, with current bindings checked at entry.
Values are never baked into cached proofs. Caller writes to a dependency,
changed domains, and custom host polling retain conservative behavior. A kernel
without native or nested calls may read guarded captures once per invocation.

Compound scalar array writes keep selector checks before RHS evaluation,
arithmetic before storing, and COW after computing the replacement value.
Slices and copies reuse the existing runtime operations, including lazy-write
errors, module checks, builtin identity, and retained selection semantics.
Prepared storage readers and writers are refreshed after rebinding and COW;
private kernels borrow existing owned storage without bypassing revisions.

Caller regions combining indexed writes with array-returning calls still
decline. Nested captured helpers and unsupported call graphs remain outside
this proof. No modular kernel backend or compiler unification is introduced.

Compiler diagnostics additionally retain up to 64 bounded syntax snapshots of
failed scalar proofs, including cached failures, while preserving existing
fallback counters. The list contains no ASTs, frames, or runtime values.

## Verification and reproduction

The merged workspace build, semantic-boundary checks, and application-form
checks pass. The ordinary interpreter run passes 252 files / 4940 tests;
the exhaustive type/differential demo suites and Nurikabe suite are excluded
from that run. Ten selected type/differential demo checks and the Euler 324 CLI
fixture pass separately. New differential tests compare values, errors with
locations and call stacks, and published caller state, and assert compilation
of the actual outer recurrence loop.

```sh
npx tsc -b tsconfig.build.json
node benchmarks/modular-recurrence.mjs --modes=stored --trials=3 \
  --baseline=/path/to/separately-built-main/packages/interpreter/out/index.js
node benchmarks/modular-recurrence.mjs --worker=stored --diagnostics
```

[Fresh-process samples](baselines/2026-10-21-compiled-recurrence.jsonl) and
[separate diagnostics](baselines/2026-10-21-compiled-recurrence-diagnostics.jsonl)
include answers and source hashes. The
[finite checkpoints](baselines/2026-10-21-compiled-recurrence-checkpoints.jsonl)
were verified separately.
