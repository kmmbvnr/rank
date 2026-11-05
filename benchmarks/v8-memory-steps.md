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

## Remaining steps

2. Specialize unary operations and representations.
3. Reduce short-lived arrays around interpreted numeric expressions.
4. Expand positional calls at compiled/runtime boundaries.
5. Construct scalar function variants lazily.
6. Fuse polynomial producers into scatter/fold consumers.

Each requires its own workload evidence before retaining a runtime patch.
