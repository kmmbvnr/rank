# V8 runtime memory investigation

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

## Remaining steps

5. Construct scalar function variants lazily.
6. Fuse polynomial producers into scatter/fold consumers.

Each requires its own workload evidence before retaining a runtime patch.
