# V8 runtime memory investigation

Update: the recheck below supersedes the initial blanket rejection. Unary
output-buffer reuse is now accepted based on an exercising Rank workload.

Acceptance: retain a runtime change only with correct results, demonstrated
memory savings on affected Euler workloads, and no measured speed regression.
Use separate commits for accepted steps; record rejected candidates as well.
Base: 4e5fe2bc. Worktree branch: perf/v8-memory-steps.

## 1. Reuse unary compact integer output: skipped

Prototype: reuse `cells` instead of allocating a second Int32 output in
`mapStoredUnary`. The compact successful branch saves exactly 4 bytes per
cell. On Node v24.15.0 / Mac, five alternating fresh-process samples gave
kernel medians 2.789 -> 2.576 ms for one million identical integer inputs.
Allocated ArrayBuffer bytes dropped from 8,000,000 to 4,000,000.
The 21 existing unary-array-kernel tests passed. A direct widening probe
also returned the expected 2147483728n.

However, Euler 42 did not exercise this allocation path. A separate run
instrumenting Int32Array constructors reported zero Int32 allocations in
both versions, with the correct official answer 162. Its deferred Roots
expression cannot establish a memory benefit from this patch. The earlier
combined kernel/Euler RSS measurements are contaminated by the preceding
kernel probe and must not be interpreted as Euler memory savings.

The runtime prototype was removed because the Euler acceptance gate is
unproven. This is not a claim that the redundant allocation is useful.
No Intel comparison was made for this rejected candidate.

`v8-unary-memory.mjs CHECKOUT` runs the isolated kernel probe against a built
checkout. `v8-euler-memory.mjs CHECKOUT [--allocations]` runs Euler 42 alone
with the official word list extracted from its existing test. Allocation
instrumentation is a diagnostic pass; do not use its timings as benchmarks.
`baselines/2026-11-05-v8-memory/unary-mac.json` preserves the initial series,
including the contaminated combined-process RSS numbers described above.

## 2. Specialize unary operations: skipped

Code inspection found that operation specialization alone retains the same
input view, output buffer, publication wrapper and widening behavior in
`jit/unary-array-kernel.ts`. Removing `operation(...)` dispatch or hoisting
`if (!out)` does not eliminate a per-cell allocation: values here are Number
registers, not boxed Rank records. Adding operation-specific loop bodies
would increase static code. There is no identified memory-saving mechanism
for this candidate, so it is rejected under the memory acceptance gate
before expanding runtime code. No speed improvement is claimed or measured.
A speed-only experiment can be considered separately if that goal changes.

## 3. Numeric cell coordinates: skipped

Prototype in `experiments/v8-ranked-cell-coordinates.patch` computes frame
storage offsets directly, allocating coordinate arrays only when nested
array-cell slicing needs them. Natural leading frames use multiplication.
This removes two temporary coordinate arrays and their callback from each
flat-storage cell read. Euler 491 full input exercised the allocation-free
branch 119,724 times in a separate instrumented run. It returned the exact
answer 194505988824000. Euler 701 4x4 did not exercise this branch.

Nine alternating fresh-process pairs, Node v24.15.0 on both hosts:

| Host | Metric | Baseline | Prototype |
| --- | --- | ---: | ---: |
| Mac | Median milliseconds | 314.61 | 317.48 |
| Mac | Median peak RSS KiB | 346560 | 334272 |
| Mac | Median retained heap bytes | 39236712 | 37148408 |
| Intel | Median milliseconds | 937.36 | 874.57 |
| Intel | Median peak RSS KiB | 318216 | 328740 |
| Intel | Median retained heap bytes | 37155104 | 39243576 |

Mac timing was noisy (baseline mean 331.92 ms, SD 29.48; prototype mean
314.04 ms, SD 21.90). This does not establish a Mac speed regression or
speedup. Intel memory increased despite fewer temporary allocations.
Consequently the candidate fails the cross-host memory gate and is removed.
No claim is made about the cause of the retained-heap reversal.
The earlier general scalar-only shortcut was also unhelpful on Euler 701;
its five-pair exploratory series is preserved as scalar-cell-mac.json.

109 focused rank/axis tests passed on the final prototype, plus TypeScript
build. No full suite or exhaustive audits were run.

`v8-ranked-cell-memory.mjs CHECKOUT [491|077|701]` checks answers, times program
execution after parsing, then measures retained heap after explicit GC and
process peak RSS. `scalarReads` is null in normal timing passes; the count
above was obtained by a temporary increment in the flat-storage branch.
Both hosts used the same unmodified Euler 491 demo. Raw observations are
in `baselines/2026-11-05-v8-memory/ranked-cell-491-{mac,intel}.json`.

## 4. Exact positional native calls: skipped

Prototype in `experiments/v8-exact-positional.patch` registers exact scalar
positional implementations, guarded by builtin identity, original native
call identity, typedNativeCalls option and absence of interrupts. A powmod
implementation accepts three exact integer arguments without an argument
array. Number mode retains the existing Number ABI.

Three Euler probes returned correct results: 48 default, 48 with Digits=20,
and 188 default. The 20-digit result was checked against independent direct
BigInt exponentiation and reduction for all 1000 terms. An instrumented
wrapper around the new exact positional entry recorded zero invocations in
all three probes. Thus these programs establish no memory benefit for the
new ABI; merely adding it is insufficient. The candidate was removed under
the acceptance gate, with no Intel timing series because the selected
workloads do not exercise it. Diagnostics are saved in
`baselines/2026-11-05-v8-memory/exact-positional-diagnostic.json`; null means
no increment occurred. Timings from that instrumented pass are exploratory.
Existing Number positional calls were already present before this work.
The TypeScript build and 31 existing typed-native/powmod-array tests passed
on the prototype.

## 5. Lazy scalar run variant: skipped

Prototype in `experiments/v8-lazy-scalar-run.patch` defers construction of the
array-ABI run variant until first use. The positional direct variant still
compiles eagerly, retaining the entry-time CSP fallback. A captured Function
constructor avoids changing behavior merely because a host replaces the
global property after preparation. Deferred construction remains a tradeoff
if host CSP changes after preparation; the prototype was not retained.

Separate instrumentation confirmed eager baseline run construction on Euler
26 (2), 44 (2), and 48 (1), versus zero constructions in the lazy candidate.
These tasks use other variants. 188 did not compile a run variant in either.
All exact answers matched and 30 scalar-function-kernel tests passed.

Nine alternating fresh-process pairs per task, Node v24.15.0, full inputs:

| Host / Euler | Time ms before/after | Peak RSS KiB before/after | Retained heap bytes before/after |
| --- | ---: | ---: | ---: |
| Mac / 26 | 16.850 / 16.886 | 178256 / 165376 | 32046928 / 32051504 |
| Mac / 44 | 93.856 / 94.039 | 181296 / 180592 | 33953400 / 33964808 |
| Mac / 54 | 188.316 / 187.778 | 307056 / 306480 | 40922808 / 40914160 |
| Intel / 26 | 41.119 / 40.832 | 161508 / 161464 | 32050032 / 32053568 |
| Intel / 44 | 204.808 / 205.939 | 163976 / 164192 | 33954384 / 33945408 |
| Intel / 54 | 744.346 / 752.764 | 290100 / 289844 | 40842792 / 40844296 |

Mac code/metadata medians were about 23-26 KiB lower, but overall retained
heap and peak RSS did not decrease consistently across tasks and hosts.
Intel 54 was about 1.1% slower by median. These small differences cannot
establish a uniform benefit; deferred factories also retain their inputs.
Reject under the joint memory/speed gate. No runtime change retained.
Raw data: `lazy-run-{diagnostic,mac,intel}.json` in the baseline directory.

## 6. Polynomial producers into scatter/fold: skipped

The initial proposal was partly stale: HEAD already contains exact integer
producer readers and ordered keyed folds (e9050b5c and 53cbe00c). Admission
is not limited to Int32 intermediates. The existing keyed-producers tests
cover wide arithmetic, overflow, errors, host effects and both engines.

A full Euler 326 keyed-plan control exercised 24 native reader preparations
and 12 integer folds and returned 1966666166408794329. Three uninstrumented
Mac controls of the keyed-plan formulation took a median 2746 ms / 494176
KiB peak RSS, versus 136 ms / 249520 KiB for weighted scatter and 88 ms /
180000 KiB for the production scalar formulation. These are algorithmic
controls, not a runtime before/after speed claim. The keyed formulation
keeps separate Seen/Tail histograms and is not adopted as an optimization.

The direct runtime prototype in `experiments/v8-scatter-producer.patch`
streams a deferred integer key producer into one checked offset snapshot
in tensorSelection, before RHS evaluation or target writes. This avoids
materializing the producer as a separate Rank key array. It keeps private
polling, inspection and demand-budget eligibility checks. A deferred-key
version of the weighted Euler 326 fixture exercises this path (12 native
reader preparations, zero keyed folds). Both versions return the exact
full answer. No producer-specific bypass is added to error handling.

Three alternating fresh-process pairs on Mac / Node v24.15.0:

| Metric | Baseline | Producer snapshot |
| --- | ---: | ---: |
| Median milliseconds | 708.254 | 1440.140 |
| Median peak RSS KiB | 242752 | 237040 |
| Median retained heap bytes | 34013200 | 33792520 |

Reject: the memory saving costs about 2x execution time. No Intel series
was needed once this speed gate failed. The exact per-cell BigInt reader
replaces a bulk materialization path; this is a candidate explanation, not
a CPU-profile finding. A Number-specialized streaming producer compiler
would be separate future work, not a result delivered here.

87 keyed-producer/fusion/Euler-326 tests passed while inspecting the existing
fold path. 118 selector-type-checks/accumulate-writes tests passed on the direct
scatter prototype. The TypeScript build passed. Exhaustive audits and
the full suite were not run.

`v8-producer-fold-memory.mjs CHECKOUT VARIANT [--diagnostics]` runs the full
Euler input. Variants are production, keyed, accumulate, accumulate-deferred.
Fixtures preserve the formula and only defer Keys/Part in the final variant.
Raw observations are producer-fold-mac.json, scatter-producer-mac.json and
scatter-producer-diagnostic.json in the baseline directory. The diagnostic
pass is separate from the timing series.

## Initial disposition (d84fa828)

All six steps were evaluated in order. No runtime candidate passed the joint
Euler memory/speed gate; runtime and demos are unchanged from 4e5fe2bc.
The branch contains investigation reports, reproducible probes, raw samples
and rejected prototype patches. Each completed step was committed and pushed
separately. No issue, PR or external discussion comment was created.


## Recheck: unary buffer reuse accepted

The original rejection confused lack of coverage in Euler 42 with lack of
benefit. The exercising end-to-end Rank workload now materializes one million
integers, executes `Roots = Input isqrt array`, and checks `Roots sum` against
an independent integer square-root sum. It warms up eight times and measures
12 executions per process. All values are created by the tested interpreter.
A separate constructor-counting pass reports 24 -> 12 Int32 allocations and
96 -> 48 million allocated bytes. Post-GC buffer delta is zero in both:
the improvement is allocation volume, not retained output size.

The first A/B series used different module paths and showed a suspicious
Mac Euler 491 difference despite only unary-array-kernel.js differing.
The final series uses the same module path, swaps only that generated file,
and pairs V8 random seeds 101..109 with alternating order. Timing passes
have no allocation instrumentation. Each process checks its exact answer.

| Host | Rank unary median ms | Euler 491 median ms |
| --- | ---: | ---: |
| Mac | 3.448 -> 3.199 | 323.557 -> 321.784 |
| Intel | 9.856 -> 9.670 | 937.081 -> 934.075 |

These nine paired-process series show no speed regression in the exercised
workload or Euler control. Both hosts use Node v24.15.0. Tests: 22 unary
kernel tests, including a new compact-prefix/late-widening regression test.
The full suite and exhaustive audits were not run.

Reproduce with `v8-unary-samepath.py NODE BASELINE OUTPUT.json` in a built
candidate checkout. It restores the candidate JS in a finally block.
`v8-unary-recheck.mjs CHECKOUT --allocations` measures constructor bytes
separately. Raw files are unary-recheck-{mac,intel,allocations}.json and
unary-samepath-{mac,intel}.json. The initial different-path series remains
available and is not used as evidence of a causal Euler regression.
