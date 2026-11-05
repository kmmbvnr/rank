# Further optimization of the original Euler 23 array loop

The original Rank source is unchanged. A private Number region can stream a
pure integer selector map into a boolean destination with a literal RHS. This
removes the `A + B` temporary and its separate materialization/validation passes.
The named `B = ...` stage still completes and retains its normal snapshot.

The input numeric buffers must be disjoint from the destination. Streaming is
disabled whenever interrupts or demand budgets are enabled: their preparation
and publication/work boundaries stay on the existing implementation. With no
observer, selector failures discard the invocation-private stores and replay the
ordinary exact region. The complete selector is then validated before any RHS
or public store, preserving the original error and preceding state. Literal RHS
values have no deferred reads or effects to reorder. No language rules changed.

A two-pass prototype validated and recomputed every address. It did not give a
convincing benefit. The delivered candidate combines address computation and
private stores, using the existing rollback boundary for failures.

## Measurements

Three alternating fresh Node 24.15.0 processes per case. The before compiler
is 6763c766; imports precede timing. Unrelated host load was not controlled.

| Pair-marking phase | Mac ARM64 before → after | Intel x64 before → after |
| --- | ---: | ---: |
| Compiled | 197 → 154 ms | 333 → 277 ms |
| Reference | 1260 → 508 ms | 2760 → 1234 ms |

Compiled process peak RSS: 267 → 244 MiB on Mac, 246 → 240 MiB on Intel.
Whole compiled time: 440 → 381 ms on Mac, 1044 → 1037 ms on Intel; the unchanged
sieve dominates the Intel total, so a full-program speedup is not established.
Reference full-program times are 1.48 → 0.72 s on Mac and 3.48 → 1.93 s on Intel.

The reference results include a separate native-storage change: scalar boolean
fills may use `fillBooleanSelection` with JIT disabled or observable polling.
That implementation already existed as an uncommitted edit in the shared
workspace when this investigation started. Its primitive checks demand and
reloads storage after host callbacks. It was tested in isolation here; the
shared edit was preserved, not overwritten or claimed as a new compiler change.

Mac custom mobile-signal model: 11.91 → 9.76 s total. Its median peak RSS was
429 → 457 MiB, so this experiment does not establish a mobile memory reduction.
The new streaming backend is deliberately inactive there. Scalar comparison
mask construction remains a major cost; the shared workspace also has a separate
pending optimization for observable integer comparisons, outside this measured
candidate. These are not new phone measurements.

All measured answers were 4179871. Raw samples are in
`baselines/2026-11-03-euler023-scatter.json`. The existing
`euler023-followup.mjs original compiled|reference|mobile` worker was used with
`RANK023_RUNTIME` selecting each isolated runtime.

## Verification

523 tests in six focused files passed on Mac, including selector failures after
private stores, scalar result types, alias/snapshot behavior, Number overflow,
observable boolean fills and demand-budget prefixes. On Intel, 32 scatter and
native-fill tests passed. The TypeScript build passed. Full/exhaustive audits
were not run.

Remaining work is broader than deleting a result value: infer when a filtered
binding can disappear, or exploit a proven sorted source to avoid scanning its
whole comparison mask on every iteration. These need their own bounds, mutation
and observation proofs. This change keeps the `B` binding and the algorithm.
