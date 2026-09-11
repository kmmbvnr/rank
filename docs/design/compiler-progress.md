# Compiler progress

## Queue loop entry: cached type summaries

2026-09-11, based on `1fa5816`, Apple M5, Node v24.15.0.
The interpreter used to copy and classify the entire queue on each loop entry.
A queue now retains a type-summary snapshot until push, pushfront or pop changes
its contents. A new snapshot never mutates the set retained by a loop variable.
Iteration remains live, including appends during breadth-first traversal.

Euler 23 unchanged demo tests, three fresh interpreter samples per version:
median **7403 ms → 1311 ms (5.65x)**. Complete test-result digests match.
The baseline first sample overlapped the unit test run; the other two baseline
samples were 7403 and 7350 ms, and all candidate samples were 1299–1312 ms.
This is a runtime improvement, not additional tensor compiler coverage.

The TypeScript suite passes: 44 language and 580 interpreter tests. Three added
tests check reuse, snapshot stability, mutations, aliasing and loop type errors.

[Raw measurements](../../benchmarks/baselines/2026-09-11-queue-type-summary.json)

Next: let compiled tensor pipelines reuse already materialized lazy caches.
This must not force inputs or bypass their per-element cache semantics.

## Reusing completed lazy caches in tensor kernels

The compiler now has an internal storage lookup for runtime-owned lazy values.
The first producer is `round`: once all its elements have already been evaluated,
the kernel can read a private snapshot of those cached values. Lookup never forces
an uncached element. Unknown readers still decline; there is no automatic
materialization and no attempt to compile an arbitrary callback.

The snapshot adds one shallow array allocation when the compiler first uses a
complete cache. It is separate from public `items`, because host edits to that
array do not change the values returned by the existing `round.itemAt` cache.
Further uses reuse the snapshot. This is an incremental storage protocol, not
yet fusion through unevaluated lazy expressions.

Five alternating samples per mode, unchanged programs, fresh interpreters:

| Task | Fusion off ms | Fusion on ms | Kernels |
| --- | ---: | ---: | ---: |
| Stick Game 100000 x 100 | 1884.547 | 335.288 | 100000 |
| Jacobi 128 x 128, 10 iterations | 21.788 | 5.909 | 1271 |
| Linear SVM 32 x 64, 3 iterations | 27.741 | 8.639 | 3072 |

Only Jacobi gains coverage from this step: previously 128 kernels and about
19 ms with fusion. Nine later iterations use the ordinary path for their first
row, which fills the cache; the remaining 127 rows then fuse. Stick Game and SVM
remain controls for the already existing tensor compiler. Backprop, Euler 6 and
Linear Equations still execute no generated tensor kernels; their timing changes
in the raw report are not attributed to fusion.

The TypeScript suite passes 44 language and 584 interpreter tests. New tests
cover unknown getters, partial caches, source mutation after caching, public
array edits, matching results and actual compiled execution.

[Raw task measurements](../../benchmarks/baselines/2026-09-11-cached-tensor-tasks.json)

The next compiler stages remain: other cache-owning producers, expression
terminals beyond assignment/reduction, explicit axis/rank domains, and scalar
loop control. A complete program compiler is not yet implemented.

Full demo-suite verification: both modes pass all 306 files / 1054 tests,
with matching complete result/output digests, also matching the queue-only
revision. Single-run wall times (not a stable small-speedup estimate):
- Fusion off: 35.189 s.
- Fusion on: 36.655 s.

[Full suite report](../../benchmarks/baselines/2026-09-11-cached-tensor-suite.json)
