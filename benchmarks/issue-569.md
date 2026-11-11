# Call and collection overhead: issue 569

## Method

Baseline: `9177bb48`, including the delivered nightly repairs. Node 24.15.0,
Mac ARM64 and Intel x64. The nightly harness checks identical source hashes
and complete answers in fresh processes, alternating before/after order for
three pairs. Times below are medians, not confidence bounds. CPU profiles are
separate from timing comparisons. Full suites and exhaustive audits are not
part of this targeted check.

Raw samples: [baseline archive](baselines/2026-11-11-issue-569.json).

## Speed 1 and 2: positional recursive bridge

A bounded arity-specialized bridge keeps arguments and their Number conversions
in local variables. It creates argument arrays only on error or tail-transfer
paths. Arity above 16 retains the existing generic implementation. Static
admission reasons are selected during preparation; hooks, polling, demand
budget and read-only admission remain dynamic. Overflow replay, backoff,
recursion depth and return contracts retain their previous behavior.

| Case | Mac before / after, s | Intel before / after, s |
| --- | ---: | ---: |
| Euler 505, input 100000000000 | 4.055 / 3.807 | 12.315 / 10.638 |
| Euler 452, default input | 0.603 / 0.593 | 1.674 / 1.638 |
| Euler 792, default input, control | 14.385 / 14.368 | not measured for this bridge |

Euler 505 improves by 6.1% on Mac and 13.6% on Intel by median. Mac's three
candidate samples range from 3.617 to 4.297 seconds: the smaller Mac benefit
is noisy. Intel improves in all three pairs. This does not establish the same
speedup at Euler 505's default input of 1000000000000.

A separate static-conditions-only experiment at the default Euler 505 input
changes the median from 65.849 to 66.247 seconds on Mac and 195.415 to 187.943
seconds on Intel. Euler 452 changes from 0.606 to 0.593 and 1.645 to 1.665
seconds respectively. Static folding alone is not a consistent acceleration;
it is retained as part of the measured positional bridge.

Verification: TypeScript and 206 focused tests in nine files, including
recursive calls, tail calls, function composition, private state, observation,
wide-input replay and the arity boundary. The previous static-only experiment
passed 76 focused tests.

Repeat the bridge comparison:

```sh
CASES=452,505 ROUNDS=3 \
CASE_INPUTS='{"505":{"args":["100000000000"],"answer":"459260736097816346"}}' \
node benchmarks/experiments/nightly-2026-11-11.mjs BEFORE AFTER
```

Set `PROFILE_DIR` to save CPU profiles; profiled runs are marked in the JSON
and must not be mixed with timing samples. The remaining decisions and their evidence are recorded below.

## Speed 4: collect prepared readers directly

Prepared scalar readers now write directly to the destination. This removes
one iterator-result object per cell and the generator transition for eligible
readers. Explicit traversals, custom collectors and zero-cell observations keep
the existing path, including iterator cleanup. Checkpoints, soft missing values,
strict errors and writes to the completed prefix retain their order.

Measured independently of the bridge against `9177bb48`:

| Case | Mac before / after, s | Intel before / after, s |
| --- | ---: | ---: |
| Euler 792, default input | 14.117 / 11.570 | 37.656 / 32.505 |
| Euler 98, default input, control | 0.375 / 0.379 | 1.075 / 1.063 |

Euler 792 improves by 18.0% on Mac and 13.7% on Intel. Euler 98 shows no
consistent change. Timing is separate from memory: Mac median peak RSS is
812 / 813 MiB, while the corresponding Intel samples are recorded in the raw
archive. Do not infer a general memory reduction from this change.

Verification: TypeScript and 100 focused tests in five files. Added cases cover
prepared read order, widening and soft missing values, stopping at a strict
missing value, and explicit traversal precedence with cleanup after an error.

## Scalar completion after collection

The profiles also showed child-completion records being allocated for already
computed scalar cells. The materializer now advances over those cells without
allocating a temporary object. Checkpoints still run at the same cell boundary;
deferred values, nested containers, aliasing and existing NaN handling retain
their original path.

This is measured incrementally against the prepared-reader collector:

| Case | Mac before / after, s | Intel before / after, s |
| --- | ---: | ---: |
| Euler 792, default input | 11.971 / 10.198 | 32.635 / 30.218 |
| Euler 98, default input, control | 0.386 / 0.384 | 1.023 / 1.039 |

Euler 792 improves by another 14.8% on Mac and 7.4% on Intel. The control
shows no consistent acceleration. Mac median peak RSS changes from 829 to
795 MiB; this is whole-process peak RSS, not the size of one allocation.

Verification: TypeScript and 141 focused tests in six files, including nested,
grouped and table materialization, deferred bindings and collection contracts.

## Speed 6: observation switching rejected

A tested prototype changed positional wrappers at diagnostic-scope entry/exit,
including nested scopes and exceptions, instead of checking tracing on each
call. Weak references and finalization kept disposed interpreters collectible.
It passed 85 focused tests but did not produce a consistent speedup:

| Case | Mac before / after, s | Intel before / after, s |
| --- | ---: | ---: |
| Euler 505, input 100000000000 | 3.376 / 3.366 | 10.233 / 10.441 |
| Euler 507, default input | 5.710 / 5.695 | 14.554 / 14.680 |

The baseline here includes the positional bridge. The prototype also included
the array-completion changes, which do not explain a gain in these tests.
With negligible Mac differences and slightly slower Intel medians, the extra
lifecycle machinery is not justified. The prototype was removed; production
retains the existing dynamic tracing checks. The raw archive includes its patch
and all samples so that the experiment can be reproduced.

## Profile-led decisions on remaining candidates

Profiles were collected separately on Mac and Intel for Euler 505 and 792.
They include process startup/imports, so percentages describe CPU samples,
not precise wall-time attribution. Reproduce with `PROFILE_DIR` and summarize
with `benchmarks/experiments/issue-569-profile-summary.py`.

- **Speed 3, inline/range/Int32 Number guards:** not taken for these workloads.
  Euler 505's reduced-input diagnostic run enters no Number function and skips
  47,593,981 probes during argument backoff. Euler 792 also enters no Number
  function; its work is tensor/array arithmetic. Its exact wide-integer remainder
  alone accounts for 13.8% of Mac samples and 16.5–16.7% of Intel samples.
  Removing guards from an unselected Number backend cannot accelerate that work.
  Other workloads may justify this optimization; these profiles do not.
- **Speed 5, repeated binding range checks:** not taken. The binding collector's
  write callback, including callees, accounts for 0.85% of Mac samples and about
  0.95–1.00% on Intel. Removing range checks can save only part of that. The
  measured collection/materialization changes address the substantially larger
  iterator and temporary-object costs without changing integer storage invariants.
- **Memory 1, Float64 integer tier:** not taken. In Euler 792's 2,000,000-cell
  Rows matrix, 10,005 cells fit int32, four additional cells fit safe Number,
  two additional cells fit int64 and 1,989,989 exceed int64. A new tier would
  not address this workload. It is technically possible only with an explicit
  integer domain retained through views, copies, borrowing and COW: current
  Float64 storage normally represents real values, while integer borrowing
  recognizes Int32/BigInt64. It is not a compatible local storage substitution.
- **Memory 2, sparse wide exceptions:** rejected for this workload: 99.49945%
  of Rows cells need wide integers. A sparse exception table would hold almost
  the entire matrix in addition to the packed buffer. The distribution script
  stops after constructing Rows and is explicitly not a timing benchmark.
- **Memory 3, direct prefix reads:** not taken. `IntegerCells.array()` calls
  `typedArray()` with its existing packed buffer; `createOwned()` retains that
  buffer. It allocates a temporary header/ownership record, not another typed
  buffer. The prefix-read cost is included in the approximately 1% collector
  callback above. Changing this shared storage API has no profile-supported
  payoff in the measured programs.

These decisions resolve the listed candidates for this investigation, rather
than asserting that no future program can benefit from them. Timing, allocation
counts and whole-process peak RSS remain separate measurements.

## Memory attribution check

A separate full-answer instrumentation run on the repaired baseline observed
200 prefix publications. Every publication retained the same typed buffer:
**zero prefix buffers were copied**. The largest packed capacity was 8,000,000
bytes (7.63 MiB), and the largest ordinary destination had 2,000,000 reference
slots. Published prefix capacity summed to 804,000,000 bytes over the run;
that is cumulative traffic, not simultaneous live memory.

RSS sampled at prefix-publication boundaries reached 794.4 MiB, equal to that
instrumented process's peak. This locates a high-memory phase but does not
establish what fraction of RSS is caused by the transition: retained BigInts,
reference arrays, other tensors and V8's unused pages coexist. We therefore do
not assign an invented percentage to the transition. The measured dense-wide
cell distribution and zero typed-buffer copies do not support the proposed
sparse tier or an alleged extra full-buffer prefix copy. Reproduce with
`issue-569-storage.mjs`; its instrumentation is excluded from performance runs.

## Final verification and the historical Euler 505 gap

The final runtime includes the positional bridge, prepared-reader collector
and scalar-completion fast path, with the observation-switch prototype removed.
A direct three-pair comparison against `afc824b0`, using the same explicit
Euler 505 input `100000000000` that exposed the original gap, gives:

| Architecture | Historical median, s | Final median, s | Final / historical |
| --- | ---: | ---: | ---: |
| Mac ARM64 | 3.408 | 3.330 | 0.977 |
| Intel x64 | 10.085 | 9.952 | 0.987 |

The reported 13.7% Intel gap is no longer present in this comparison. The small
remaining differences are within the spread of three pairs; this is recovery
to approximately historical performance, not a claim of a new stable 1–2%
speedup. Before the bridge, a fresh historical comparison still showed 18.4%
slower Intel execution. Comparative profiles expose the additional recursive
call/dispatch path and unsuccessful Number probing; the unchanged exact
arithmetic and captured-value reads dominate the rest. This profile attribution
is evidence of where time is spent, not an additive causal accounting.

The full default Euler 505 input also produces `714591308667615832` on the final
Mac build. A final full-input integration pair checks the combined runtime
against `9177bb48`:

| Case | Mac before / final, s | Intel before / final, s |
| --- | ---: | ---: |
| Euler 98 | 0.372 / 0.371 | 1.004 / 1.040 |
| Euler 507 | 5.706 / 5.700 | 14.342 / 14.347 |
| Euler 792 | 13.414 / 9.712 | 36.349 / 29.697 |

This single integration pair is consistent with the independently repeated
step measurements; it is not a replacement for them. Euler 792's final-pair
peak RSS is 811 / 796 MiB on Mac and 708 / 706 MiB on Intel. The main measured
benefit is speed, with modest and variable peak-memory changes.

Final checks: TypeScript; 401 interpreter tests in 18 focused files; 13 CLI
diagnostics tests; semantic boundaries (65 owners); application-form checks;
source/output equality in every benchmark pair; whitespace validation. Full
repository tests and exhaustive audits were not started. The CI run visible
during this check targets the preceding CI-budget change and is still running;
these results do not claim a complete green CI audit.

All six speed candidates and three memory candidates now have a recorded
implementation or an evidence-backed decision not to proceed. No candidate is
left implicitly accepted or silently deferred.
